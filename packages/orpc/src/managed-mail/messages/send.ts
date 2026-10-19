import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  managedMailMessage,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import {
  buildMimeMessage,
  normalizeComposeBodyHtml,
} from "@quieter/mail/compose/mime";
import {
  extractMailAddress,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import type { composeMessageInputSchema } from "@quieter/mail/compose/schema";
import { resolveManagedMailSender } from "@quieter/mail/compose/sender";
import { parseRawMailMessage } from "@quieter/mail/raw-message";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { sendPreparedMail } from "../../mail-send";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import {
  buildOpenTrackingHtmlTransform,
  resolveOrganizationMailOpenTracking,
} from "../../organization-mail-delivery";
import { OrganizationMailSendError } from "../../organization-mail-policy";
import { hashRequest } from "../../request-hash";

export const sendManagedMailboxMessage = async (input: {
  mailboxId: string;
  message: z.infer<typeof composeMessageInputSchema>;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["responder", "manager"],
    userId: input.userId,
  });
  const { organizationId } = selectedMailbox;
  if (organizationId === null) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Managed mailbox team is missing.",
    });
  }
  const { message } = input;
  const idempotencyKey = `compose:${input.mailboxId}:${message.sendOperationId ?? message.localId}`;
  const [prior] = await db
    .select({ status: organizationMailSendIdempotency.status })
    .from(organizationMailSendIdempotency)
    .where(
      and(
        eq(organizationMailSendIdempotency.organizationId, organizationId),
        eq(organizationMailSendIdempotency.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  const draftId = message.draftId ?? `draft:${message.localId}`;
  const [draft] = await db
    .select({
      id: managedMailMessage.id,
      updatedAt: managedMailMessage.updatedAt,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.providerMessageId, draftId),
        eq(managedMailMessage.mailboxState, "draft")
      )
    )
    .limit(1);
  const files = await Promise.all(
    [
      ...message.inlineImages,
      ...message.attachments.filter((attachment) => !attachment.isInline),
    ].map(async (attachment) => {
      if (!(attachment.file instanceof Blob)) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "An attachment is missing its file content. Attach the file again.",
        });
      }
      return {
        contentId: attachment.contentId,
        hash: createHash("sha256")
          .update(Buffer.from(await attachment.file.arrayBuffer()))
          .digest("hex"),
        mimeType: attachment.mimeType,
        name: attachment.name,
      };
    })
  );
  const requestHash = hashRequest({
    bodyHtml: normalizeComposeBodyHtml(message),
    bodyText: message.bodyText,
    files,
    headers: message.headers,
    recipients: message.recipients,
    replyContext: message.replyContext,
    senderName: message.senderName?.trim() || undefined,
    subject: message.subject,
  });
  if (draft !== undefined) {
    const [boundSend] = await db
      .select()
      .from(organizationMailSendIdempotency)
      .where(
        and(
          eq(organizationMailSendIdempotency.organizationId, organizationId),
          sql`${organizationMailSendIdempotency.snapshot}->>'draftId' = ${draft.id}`,
          sql`${organizationMailSendIdempotency.snapshot}->>'draftUpdatedAt' = ${draft.updatedAt.toISOString()}`,
          inArray(organizationMailSendIdempotency.status, [
            "submitting",
            "unknown",
            "accepted",
            "completed",
          ])
        )
      )
      .limit(1);
    if (
      boundSend !== undefined &&
      boundSend.idempotencyKey !== idempotencyKey
    ) {
      throw new ORPCError("CONFLICT", {
        data: { draftConflict: true },
        message:
          "This draft already has a send attempt from another editor. Check Sent before recovering your changes as a new draft.",
      });
    }
  }
  if (
    (prior === undefined ||
      prior.status === "prepared" ||
      prior.status === "rejected") &&
    ((draft !== undefined &&
      message.baseRevision !== draft.updatedAt.toISOString()) ||
      (draft === undefined && !!message.draftId))
  ) {
    throw new ORPCError("CONFLICT", {
      data: { draftConflict: true },
      message: "This draft changed elsewhere. Reopen it before sending again.",
    });
  }
  const id = randomUUID();
  const sentAt = new Date();
  const messageHeaderId = `<${id}@${selectedMailbox.emailAddress.split("@").at(1)}>`;
  const openTrackingEnabled = await resolveOrganizationMailOpenTracking({
    organizationId,
  });
  const raw = await buildMimeMessage(message, {
    from: resolveManagedMailSender(selectedMailbox, message.senderName),
    messageId: messageHeaderId,
    omitBccHeader: true,
    sentAt,
    ...buildOpenTrackingHtmlTransform({ messageHeaderId, openTrackingEnabled }),
  });
  const parsed = await parseRawMailMessage(raw);
  try {
    const result = await sendPreparedMail({
      id,
      idempotencyKey,
      messageHeaderId,
      organizationId,
      raw,
      requestHash,
      snapshot: {
        attachments: parsed.attachments.map((attachment, partIndex) => ({
          ...attachment,
          partIndex,
        })),
        bcc: splitMailAddressList(message.recipients.bcc).map(
          extractMailAddress
        ),
        bodyHtml: parsed.bodyHtml ?? "",
        bodyText: parsed.bodyText ?? "",
        cc: splitMailAddressList(message.recipients.cc).map(extractMailAddress),
        draftId: draft?.id,
        draftUpdatedAt: draft?.updatedAt.toISOString(),
        headers: parsed.headers,
        kind: "mailbox",
        mailboxId: input.mailboxId,
        rawSizeBytes: Buffer.byteLength(raw),
        replyTo: [selectedMailbox.emailAddress],
        sender: parsed.from,
        sentAt: sentAt.toISOString(),
        subject: message.subject,
        tags: [],
        threadId: message.replyContext?.threadId,
        to: splitMailAddressList(message.recipients.to).map(extractMailAddress),
      },
    });
    return {
      draftCleanupHandled: true,
      id: result.id,
      idempotent: result.idempotent,
      messageId: result.messageId,
      threadId: result.threadId,
    };
  } catch (error) {
    if (error instanceof OrganizationMailSendError) {
      throw new ORPCError(error.status === 403 ? "FORBIDDEN" : "BAD_REQUEST", {
        message: error.message,
        status: error.status,
      });
    }
    throw error;
  }
};
