import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailMessage,
} from "@quieter/database/schema";
import { buildMimeMessage } from "@quieter/mail/compose/mime";
import type { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import { parseRawMailMessage } from "@quieter/mail/raw-message";
import { reportError } from "@quieter/observability";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
} from "../search/normalization";
import { deleteRawMailObject, getRawMailObjectReference } from "./raw-object";
import { storeRawMailObject } from "./raw-object-lifecycle";

export const saveManagedDraft = async (input: {
  draft: z.infer<typeof composeDraftInputSchema>;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["responder", "manager"],
    userId: input.userId,
  });
  const { draft, mailboxId } = input;
  const draftId = (draft.draftId?.trim() ?? "") || `draft:${draft.localId}`;
  const [existing] = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, mailboxId),
        eq(managedMailMessage.providerMessageId, draftId),
        eq(managedMailMessage.mailboxState, "draft")
      )
    )
    .limit(1);
  if ((draft.draftId ?? "") !== "" && existing === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "This draft is no longer available.",
    });
  }
  const messageId = existing?.id ?? crypto.randomUUID();
  const threadId =
    [
      draft.replyContext?.threadId,
      draft.draftAnchor?.sourceThreadId,
      existing?.threadId,
    ]
      .find((value) => value !== undefined && value.trim() !== "")
      ?.trim() ?? messageId;
  const now = new Date(
    Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1)
  );
  const raw = new TextEncoder().encode(
    await buildMimeMessage(draft, {
      from: selectedMailbox.emailAddress,
      includeQuieterDraftHeaders: true,
      sentAt: now,
    })
  );
  const parsed = await parseRawMailMessage(raw);
  const object = await storeRawMailObject(raw);
  const values = {
    bcc: draft.recipients.bcc || null,
    bccNormalized: normalizeManagedSearchValue(draft.recipients.bcc),
    bodyHtml: draft.bodyHtml || null,
    bodyText: draft.bodyText || null,
    cc: draft.recipients.cc || null,
    ccNormalized: normalizeManagedSearchValue(draft.recipients.cc),
    from: selectedMailbox.emailAddress,
    fromNormalized: normalizeManagedSearchValue(selectedMailbox.emailAddress),
    headers: parsed.headers,
    inReplyTo: draft.replyContext?.messageHeaderId ?? null,
    isRead: true,
    mailboxState: "draft" as const,
    rawObjectBucket: object.bucket,
    rawObjectKey: object.key,
    rawObjectProvider: object.provider,
    rawSizeBytes: raw.byteLength,
    references: (draft.replyContext?.references.join(" ") ?? "") || null,
    replyTo: selectedMailbox.emailAddress,
    searchText: createManagedMessageSearchText({
      bodyText: draft.bodyText,
      snippet: parsed.snippet,
      subject: draft.subject,
    }),
    sentAt: now,
    snippet: parsed.snippet ?? null,
    subject: draft.subject || null,
    threadId,
    to: draft.recipients.to || null,
    toNormalized: normalizeManagedSearchValue(draft.recipients.to),
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
    if (existing === undefined) {
      await tx.insert(managedMailMessage).values({
        ...values,
        createdAt: now,
        direction: "outbound",
        id: messageId,
        mailboxId,
        providerMessageId: draftId,
      });
    } else {
      const updated = await tx
        .update(managedMailMessage)
        .set(values)
        .where(
          and(
            eq(managedMailMessage.id, existing.id),
            eq(managedMailMessage.mailboxId, mailboxId),
            eq(managedMailMessage.mailboxState, "draft"),
            eq(managedMailMessage.updatedAt, existing.updatedAt)
          )
        )
        .returning({ id: managedMailMessage.id });
      if (updated.length === 0) {
        throw new ORPCError("CONFLICT", {
          message:
            "This draft changed elsewhere. Reopen it before saving again.",
        });
      }
    }
    await tx
      .delete(managedMailAttachment)
      .where(
        and(
          eq(managedMailAttachment.messageId, messageId),
          eq(managedMailAttachment.mailboxId, mailboxId)
        )
      );
    if (parsed.attachments.length > 0) {
      await tx.insert(managedMailAttachment).values(
        parsed.attachments.map((attachment, partIndex) => ({
          ...attachment,
          contentId: attachment.contentId ?? null,
          createdAt: now,
          id: crypto.randomUUID(),
          mailboxId,
          messageId,
          normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
          partIndex,
        }))
      );
    }
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: now,
      })
      .where(eq(mailbox.id, mailboxId));
  });
  const previousObject =
    existing === undefined ? null : getRawMailObjectReference(existing);
  if (previousObject) {
    try {
      await deleteRawMailObject(previousObject);
    } catch (error) {
      reportError(error, {
        operation: "managed-mail:delete-replaced-draft-object",
      });
    }
  }
  return {
    bodyHtml: draft.bodyHtml,
    bodyText: draft.bodyText,
    draftAnchor: draft.draftAnchor ?? null,
    draftId,
    messageId,
    recipients: draft.recipients,
    replyContext: draft.replyContext ?? null,
    subject: draft.subject,
  };
};

export const deleteManagedDraft = async (input: {
  draftId: string;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    ...input,
    requiredRoles: ["responder", "manager"],
  });
  const deleted = await db.transaction(async (tx) => {
    const records = await tx
      .delete(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.providerMessageId, input.draftId),
          eq(managedMailMessage.mailboxState, "draft")
        )
      )
      .returning();
    if (records.length > 0) {
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, input.mailboxId));
    }
    return records[0];
  });
  if (deleted !== undefined) {
    const object = getRawMailObjectReference(deleted);
    if (object) {
      try {
        await deleteRawMailObject(object);
      } catch (error) {
        reportError(error, { operation: "managed-mail:delete-draft-object" });
      }
    }
  }
  return { deleted: true };
};
