import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  managedMailAttachment,
  managedMailMessage,
} from "@quieter/database/schema";
import { parseRawMailAttachments } from "@quieter/mail/raw-message";
import { and, eq } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import { readRawMailObject } from "./raw-object";

export const getManagedMessageAttachment = async (input: {
  attachmentId: string;
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox(input);
  const [record] = await db
    .select({ attachment: managedMailAttachment, message: managedMailMessage })
    .from(managedMailAttachment)
    .innerJoin(
      managedMailMessage,
      and(
        eq(managedMailAttachment.messageId, managedMailMessage.id),
        eq(managedMailAttachment.mailboxId, managedMailMessage.mailboxId)
      )
    )
    .where(
      and(
        eq(managedMailAttachment.id, input.attachmentId),
        eq(managedMailAttachment.messageId, input.messageId),
        eq(managedMailAttachment.mailboxId, input.mailboxId)
      )
    )
    .limit(1);
  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Attachment not found." });
  }
  const parts = await parseRawMailAttachments(
    await readRawMailObject(record.message)
  );
  const matches = parts.filter(
    (part, index) =>
      (record.attachment.partIndex === null ||
        record.attachment.partIndex === index) &&
      part.fileName === record.attachment.fileName &&
      part.mimeType === record.attachment.mimeType &&
      part.content.byteLength === record.attachment.size &&
      (part.contentId ?? null) === record.attachment.contentId &&
      part.inline === record.attachment.inline
  );
  const [attachment] = matches;
  if (matches.length !== 1 || attachment === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "The original attachment is unavailable.",
    });
  }
  return {
    attachmentId: record.attachment.id,
    file: new File([new Uint8Array(attachment.content)], attachment.fileName, {
      type: attachment.mimeType,
    }),
    size: attachment.content.byteLength,
  };
};
