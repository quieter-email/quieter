import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import type { DatabaseClient } from "@quieter/database/client";
import {
  organizationApiMailAttachment,
  organizationApiMailMessage,
} from "@quieter/database/schema";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import type { SendHeader } from "@quieter/mail/send";

import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
} from "./managed-mail/search/normalization.ts";
import { hasText } from "./text.ts";

const createSnippet = (input: { bodyHtml?: string; bodyText?: string }) => {
  const rawBody =
    input.bodyText ?? input.bodyHtml?.replaceAll(/<[^>]+>/gu, " ");
  if (!hasText(rawBody)) {
    return null;
  }
  const trimmed = rawBody.replaceAll(/\s+/gu, " ").trim().slice(0, 240);
  return hasText(trimmed) ? trimmed : null;
};

export const recordOrganizationApiMailMessage = async (
  input: {
    attachments?: {
      contentId?: string | null;
      fileName: string;
      inline: boolean;
      mimeType: string;
      size: number;
    }[];
    bcc?: string[];
    bodyHtml?: string;
    bodyText?: string;
    cc?: string[];
    headers?: SendHeader[];
    messageHeaderId?: string;
    organizationId: string;
    providerMessageId: string;
    rawSizeBytes?: number | null;
    replyTo?: string[];
    sender: string;
    senderAddress?: string;
    sentAt?: Date;
    subject: string;
    to: string[];
  },
  database: Pick<DatabaseClient, "transaction"> = db
) =>
  await database.transaction(async (transaction) => {
    const id = randomUUID();
    const sentAt = input.sentAt ?? new Date();
    const senderAddress = (
      input.senderAddress ?? extractMailAddress(input.sender)
    )
      .trim()
      .toLowerCase();
    const snippet = createSnippet({
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
    });
    const bccJoined = input.bcc?.join(", ");
    const ccJoined = input.cc?.join(", ");
    const replyToJoined = input.replyTo?.join(", ");
    const [inserted] = await transaction
      .insert(organizationApiMailMessage)
      .values({
        bcc: hasText(bccJoined) ? bccJoined : null,
        bccNormalized: normalizeManagedSearchValue(bccJoined),
        bodyHtml: input.bodyHtml ?? null,
        bodyText: input.bodyText ?? null,
        cc: hasText(ccJoined) ? ccJoined : null,
        ccNormalized: normalizeManagedSearchValue(ccJoined),
        createdAt: sentAt,
        from: input.sender,
        fromNormalized: normalizeManagedSearchValue(input.sender),
        headers: input.headers ?? [],
        id,
        messageHeaderId: input.messageHeaderId ?? null,
        organizationId: input.organizationId,
        providerMessageId: input.providerMessageId,
        rawSizeBytes: input.rawSizeBytes ?? null,
        replyTo: hasText(replyToJoined) ? replyToJoined : null,
        searchText: createManagedMessageSearchText({
          bodyText: input.bodyText,
          snippet,
          subject: input.subject,
        }),
        senderAddress,
        sentAt,
        snippet,
        subject: hasText(input.subject) ? input.subject : null,
        to: input.to.join(", "),
        toNormalized: normalizeManagedSearchValue(input.to.join(", ")),
        updatedAt: sentAt,
      })
      .onConflictDoNothing({
        target: [
          organizationApiMailMessage.organizationId,
          organizationApiMailMessage.providerMessageId,
        ],
      })
      .returning({ id: organizationApiMailMessage.id });

    const attachmentCount = input.attachments?.length ?? 0;
    if (inserted === undefined || attachmentCount === 0) {
      return inserted ?? null;
    }

    const attachments = input.attachments ?? [];
    await transaction.insert(organizationApiMailAttachment).values(
      attachments.map((attachment) => ({
        contentId: attachment.contentId ?? null,
        createdAt: sentAt,
        fileName: attachment.fileName,
        id: randomUUID(),
        inline: attachment.inline,
        messageId: inserted.id,
        mimeType: attachment.mimeType,
        normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
        organizationId: input.organizationId,
        size: attachment.size,
      }))
    );
    return inserted;
  });
