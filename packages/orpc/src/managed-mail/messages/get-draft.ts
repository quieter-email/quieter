import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  managedMailAttachment,
  managedMailMessage,
} from "@quieter/database/schema";
import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import { and, eq } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../../mailbox/access";

export const getManagedDraft = async (input: {
  mailboxId: string;
  draftId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    ...input,
    requiredRoles: ["responder", "manager"],
  });
  const [message] = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.providerMessageId, input.draftId),
        eq(managedMailMessage.mailboxState, "draft")
      )
    )
    .limit(1);
  if (message === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "This draft is no longer available.",
    });
  }
  const assets = await db
    .select()
    .from(managedMailAttachment)
    .where(
      and(
        eq(managedMailAttachment.mailboxId, input.mailboxId),
        eq(managedMailAttachment.messageId, message.id)
      )
    );
  const draftAnchor =
    parseDraftAnchorFromHeaderReader(
      (name) =>
        message.headers.find(
          (header) => header.name.toLowerCase() === name.toLowerCase()
        )?.value ?? ""
    ) ?? null;
  return {
    attachments: assets
      .filter((asset) => !asset.inline || !asset.contentId)
      .map((asset) => ({
        gmailAttachmentId: asset.id,
        id: crypto.randomUUID(),
        isInline: false as const,
        mimeType: asset.mimeType,
        name: asset.fileName,
        size: asset.size,
        sourceMessageId: message.id,
      })),
    baseRevision: message.updatedAt.toISOString(),
    bodyHtml: message.bodyHtml ?? "",
    bodyText: message.bodyText ?? "",
    draftAnchor,
    draftId: input.draftId,
    inlineImages: assets.flatMap((asset) =>
      asset.inline && asset.contentId
        ? [
            {
              contentId: asset.contentId.replaceAll(/^<|>$/gu, ""),
              gmailAttachmentId: asset.id,
              id: crypto.randomUUID(),
              isInline: true as const,
              mimeType: asset.mimeType,
              name: asset.fileName,
              size: asset.size,
              sourceMessageId: message.id,
            },
          ]
        : []
    ),
    lastSavedAt: message.updatedAt.getTime(),
    messageId: message.id,
    recipients: {
      bcc: message.bcc ?? "",
      cc: message.cc ?? "",
      to: message.to ?? "",
    },
    replyContext:
      draftAnchor?.seededBy !== "forward" && message.inReplyTo
        ? {
            messageHeaderId: message.inReplyTo ?? undefined,
            references: message.references?.match(/<[^>]+>/gu) ?? [],
            threadId: message.threadId,
          }
        : null,
    subject: message.subject ?? "",
  };
};
