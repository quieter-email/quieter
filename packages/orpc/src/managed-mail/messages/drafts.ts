import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailMessage,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import { buildMimeMessage } from "@quieter/mail/compose/mime";
import type { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import { resolveManagedMailSender } from "@quieter/mail/compose/sender";
import {
  parseRawMailAttachments,
  parseRawMailMessage,
} from "@quieter/mail/raw-message";
import { reportError } from "@quieter/observability";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { hashRequest } from "../../request-hash";
import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
} from "../search/normalization";
import {
  deleteRawMailObject,
  getRawMailObjectReference,
  readRawMailObject,
} from "./raw-object";
import { storeRawMailObject } from "./raw-object-lifecycle";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;

const hashManagedDraftContent = async (raw: Uint8Array) => {
  const message = await parseRawMailMessage(raw);
  const attachments = await parseRawMailAttachments(raw);
  return hashRequest({
    attachments: attachments.map((attachment) => ({
      contentId: attachment.contentId,
      fileName: attachment.fileName,
      hash: createHash("sha256").update(attachment.content).digest("hex"),
      inline: attachment.inline,
      mimeType: attachment.mimeType,
    })),
    bcc: message.bcc,
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    cc: message.cc,
    from: message.from,
    headers: message.headers.filter(
      (header) =>
        ![
          "bcc",
          "cc",
          "content-transfer-encoding",
          "content-type",
          "date",
          "from",
          "in-reply-to",
          "message-id",
          "mime-version",
          "references",
          "reply-to",
          "subject",
          "to",
        ].includes(header.name.toLowerCase())
    ),
    inReplyTo: message.inReplyTo,
    references: message.references,
    replyTo: message.replyTo,
    subject: message.subject,
    to: message.to,
  });
};

const toSavedManagedDraft = (
  draft: ComposeDraftInput,
  saved: { baseRevision: string; draftId: string; messageId: string },
  assets: Pick<
    typeof managedMailAttachment.$inferSelect,
    "id" | "inline" | "contentId"
  >[]
) => ({
  attachments: draft.attachments.map((asset, index) => ({
    gmailAttachmentId: assets.filter((attachment) => !attachment.inline)[index]
      ?.id,
    id: asset.id,
    isInline: false as const,
    mimeType: asset.mimeType,
    name: asset.name,
    size: asset.size,
    sourceMessageId: saved.messageId,
  })),
  ...saved,
  bodyHtml: draft.bodyHtml,
  bodyText: draft.bodyText,
  draftAnchor: draft.draftAnchor ?? null,
  inlineImages: draft.inlineImages.map((asset) => ({
    contentId: asset.contentId,
    gmailAttachmentId: assets.find(
      (attachment) =>
        attachment.inline && attachment.contentId === asset.contentId
    )?.id,
    id: asset.id,
    isInline: true as const,
    mimeType: asset.mimeType,
    name: asset.name,
    size: asset.size,
    sourceMessageId: saved.messageId,
  })),
  recipients: draft.recipients,
  replyContext: draft.replyContext ?? null,
  senderName: draft.senderName,
  subject: draft.subject,
});

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
  const [attemptedSend] = await db
    .select({ id: organizationMailSendIdempotency.id })
    .from(organizationMailSendIdempotency)
    .where(
      and(
        eq(
          organizationMailSendIdempotency.organizationId,
          selectedMailbox.organizationId ?? ""
        ),
        eq(
          organizationMailSendIdempotency.idempotencyKey,
          `compose:${mailboxId}:${draft.sendOperationId ?? draft.localId}`
        ),
        inArray(organizationMailSendIdempotency.status, [
          "submitting",
          "unknown",
          "accepted",
          "completed",
        ])
      )
    )
    .limit(1);
  if (attemptedSend !== undefined) {
    throw new ORPCError("CONFLICT", {
      data: { deliveryUncertain: true },
      message:
        "This draft already has a send attempt. Check Sent before changing it.",
    });
  }
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
  if (existing !== undefined) {
    const [pendingSend] = await db
      .select({ id: organizationMailSendIdempotency.id })
      .from(organizationMailSendIdempotency)
      .where(
        and(
          eq(
            organizationMailSendIdempotency.organizationId,
            selectedMailbox.organizationId ?? ""
          ),
          sql`${organizationMailSendIdempotency.snapshot}->>'draftId' = ${existing.id}`,
          sql`${organizationMailSendIdempotency.snapshot}->>'draftUpdatedAt' = ${existing.updatedAt.toISOString()}`,
          inArray(organizationMailSendIdempotency.status, [
            "submitting",
            "unknown",
            "accepted",
            "completed",
          ])
        )
      )
      .limit(1);
    if (pendingSend !== undefined) {
      throw new ORPCError("CONFLICT", {
        data: { deliveryUncertain: true },
        message:
          "This draft already has a send attempt. Check Sent before changing it.",
      });
    }
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
      from: resolveManagedMailSender(selectedMailbox, draft.senderName),
      includeQuieterDraftHeaders: true,
      sentAt: now,
    })
  );
  if (
    existing !== undefined &&
    draft.baseRevision !== existing.updatedAt.toISOString()
  ) {
    if (
      !draft.draftId &&
      draft.baseRevision === undefined &&
      threadId === existing.threadId
    ) {
      const requestedHash = await hashManagedDraftContent(raw);
      const storedHash = await hashManagedDraftContent(
        await readRawMailObject(existing)
      );
      if (requestedHash === storedHash) {
        return await db.transaction(async (tx) => {
          const [unchanged] = await tx
            .select({ id: managedMailMessage.id })
            .from(managedMailMessage)
            .where(
              and(
                eq(managedMailMessage.id, existing.id),
                eq(managedMailMessage.mailboxId, mailboxId),
                eq(managedMailMessage.mailboxState, "draft"),
                eq(managedMailMessage.updatedAt, existing.updatedAt)
              )
            )
            .for("update");
          if (unchanged !== undefined) {
            const assets = await tx
              .select()
              .from(managedMailAttachment)
              .where(
                and(
                  eq(managedMailAttachment.mailboxId, mailboxId),
                  eq(managedMailAttachment.messageId, existing.id)
                )
              )
              .orderBy(asc(managedMailAttachment.partIndex));
            return toSavedManagedDraft(
              draft,
              {
                baseRevision: existing.updatedAt.toISOString(),
                draftId,
                messageId: existing.id,
              },
              assets
            );
          }
          throw new ORPCError("CONFLICT", {
            data: { draftConflict: true },
            message:
              "This draft changed elsewhere. Reopen it before saving again.",
          });
        });
      }
    }
    throw new ORPCError("CONFLICT", {
      data: { draftConflict: true },
      message: "This draft changed elsewhere. Reopen it before saving again.",
    });
  }
  const parsed = await parseRawMailMessage(raw);
  const object = await storeRawMailObject(raw);
  const savedAttachments = parsed.attachments.map((attachment, partIndex) => ({
    ...attachment,
    contentId: attachment.contentId ?? null,
    createdAt: now,
    id: crypto.randomUUID(),
    mailboxId,
    messageId,
    normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
    partIndex,
  }));
  const values = {
    bcc: draft.recipients.bcc || null,
    bccNormalized: normalizeManagedSearchValue(draft.recipients.bcc),
    bodyHtml: parsed.bodyHtml || null,
    bodyText: parsed.bodyText || null,
    cc: draft.recipients.cc || null,
    ccNormalized: normalizeManagedSearchValue(draft.recipients.cc),
    from: parsed.from,
    fromNormalized: normalizeManagedSearchValue(parsed.from),
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
          data: { draftConflict: true },
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
    if (savedAttachments.length > 0) {
      await tx.insert(managedMailAttachment).values(savedAttachments);
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
  return toSavedManagedDraft(
    draft,
    { baseRevision: now.toISOString(), draftId, messageId },
    savedAttachments
  );
};

export const deleteManagedDraft = async (input: {
  baseRevision?: string;
  draftId: string;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    ...input,
    requiredRoles: ["responder", "manager"],
  });
  const deleted = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: managedMailMessage.id,
        updatedAt: managedMailMessage.updatedAt,
      })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.providerMessageId, input.draftId),
          eq(managedMailMessage.mailboxState, "draft")
        )
      )
      .limit(1)
      .for("update");
    if (
      existing !== undefined &&
      input.baseRevision !== existing.updatedAt.toISOString()
    ) {
      throw new ORPCError("CONFLICT", {
        data: { draftConflict: true },
        message:
          "This draft changed elsewhere. Reopen it before deleting again.",
      });
    }
    if (existing !== undefined) {
      const [pendingSend] = await tx
        .select({ id: organizationMailSendIdempotency.id })
        .from(organizationMailSendIdempotency)
        .where(
          and(
            eq(
              organizationMailSendIdempotency.organizationId,
              selectedMailbox.organizationId ?? ""
            ),
            sql`${organizationMailSendIdempotency.snapshot}->>'draftId' = ${existing.id}`,
            sql`${organizationMailSendIdempotency.snapshot}->>'draftUpdatedAt' = ${existing.updatedAt.toISOString()}`,
            inArray(organizationMailSendIdempotency.status, [
              "submitting",
              "unknown",
            ])
          )
        )
        .limit(1);
      if (pendingSend !== undefined) {
        throw new ORPCError("CONFLICT", {
          data: { deliveryUncertain: true },
          message:
            "The delivery result is still being confirmed. Check Sent before deleting this draft.",
        });
      }
    }
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
