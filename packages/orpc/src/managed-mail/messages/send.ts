import { createHash, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { managedMailMessage } from "@quieter/database/schema";
import { buildMimeMessage } from "@quieter/mail/compose/mime";
import {
  extractMailAddress,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import type { composeMessageInputSchema } from "@quieter/mail/compose/schema";
import { parseRawMailMessage } from "@quieter/mail/raw-message";
import { and, eq } from "drizzle-orm";
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
  const draftId = message.draftId ?? `draft:${message.localId}`;
  const [draft] = await db
    .select({
      id: managedMailMessage.id,
      sentAt: managedMailMessage.sentAt,
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
  if (
    draft !== undefined &&
    message.baseVersion !== undefined &&
    draft.sentAt.toISOString() !== message.baseVersion
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        "This draft changed elsewhere. Reopen it or save a copy before sending.",
    });
  }
  const files = await Promise.all(
    [
      ...message.inlineImages,
      ...message.attachments.filter((attachment) => !attachment.isInline),
    ].map(async (attachment) => {
      if (attachment.file === undefined || attachment.file === null) {
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
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    files,
    headers: message.headers,
    recipients: message.recipients,
    replyContext: message.replyContext,
    subject: message.subject,
  });
  const id = randomUUID();
  const sentAt = new Date();
  const messageHeaderId = `<${id}@${selectedMailbox.emailAddress.split("@").at(1)}>`;
  const openTrackingEnabled = await resolveOrganizationMailOpenTracking({
    organizationId,
  });
  const raw = await buildMimeMessage(message, {
    from: selectedMailbox.emailAddress,
    messageId: messageHeaderId,
    omitBccHeader: true,
    sentAt,
    ...buildOpenTrackingHtmlTransform({ messageHeaderId, openTrackingEnabled }),
  });
  const parsed = await parseRawMailMessage(raw);
  try {
    const result = await sendPreparedMail({
      id,
      idempotencyKey: `compose:${input.mailboxId}:${draftId}:${requestHash}`,
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
        bodyHtml: message.bodyHtml,
        bodyText: message.bodyText,
        cc: splitMailAddressList(message.recipients.cc).map(extractMailAddress),
        draftId: draft?.id,
        draftUpdatedAt: draft?.updatedAt.toISOString(),
        headers: parsed.headers,
        kind: "mailbox",
        mailboxId: input.mailboxId,
        rawSizeBytes: Buffer.byteLength(raw),
        replyTo: [selectedMailbox.emailAddress],
        sender: selectedMailbox.emailAddress,
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
