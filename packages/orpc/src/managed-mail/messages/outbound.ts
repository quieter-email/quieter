import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database/schema";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import type { SendHeader } from "@quieter/mail/send";
import { and, eq, ne, sql } from "drizzle-orm";

import {
  storeManagedSyncBody,
  withManagedSyncTransaction,
} from "../../mail-sync-runtime";
import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
} from "../search/normalization";
import type { RawMailObjectReference } from "./raw-object";

export const recordOutboundManagedMessageForSender = async (input: {
  attachments?: {
    contentId?: string | null;
    fileName: string;
    inline: boolean;
    mimeType: string;
    partIndex?: number | null;
    size: number;
  }[];
  bcc?: string[];
  bodyHtml?: string;
  bodyText?: string;
  cc?: string[];
  headers?: SendHeader[];
  id?: string;
  mailboxId?: string;
  messageHeaderId?: string;
  organizationId: string;
  providerMessageId: string;
  rawObject?: RawMailObjectReference | null;
  rawSizeBytes?: number | null;
  replyTo?: string[];
  requireApiSentMessageInclusion?: boolean;
  sender: string;
  senderAddress?: string;
  sentAt?: Date;
  subject: string;
  threadId?: string;
  to: string[];
}) => {
  const senderAddress = (
    input.senderAddress ?? extractMailAddress(input.sender)
  )
    .trim()
    .toLowerCase();
  const [senderMailbox] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        input.mailboxId === undefined
          ? eq(mailbox.emailAddress, senderAddress)
          : undefined,
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, "managed"),
        input.mailboxId === undefined
          ? undefined
          : eq(mailbox.id, input.mailboxId),
        input.requireApiSentMessageInclusion === true
          ? eq(mailbox.includeApiSentMessages, true)
          : undefined
      )
    )
    .limit(1);
  if (senderMailbox === undefined) {
    return null;
  }

  const id = input.id ?? randomUUID();
  const sentAt = input.sentAt ?? new Date();
  await storeManagedSyncBody(senderMailbox.id, {
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
  });
  return await withManagedSyncTransaction(
    senderMailbox.id,
    { messageIds: [id] },
    async (tx) => {
      const [inserted] = await tx
        .insert(managedMailMessage)
        .values({
          bcc: input.bcc?.join(", ") ? input.bcc.join(", ") : null,
          bccNormalized: normalizeManagedSearchValue(input.bcc?.join(", ")),
          bodyHtml: input.bodyHtml ?? null,
          bodyText: input.bodyText ?? null,
          cc: input.cc?.join(", ") ? input.cc.join(", ") : null,
          ccNormalized: normalizeManagedSearchValue(input.cc?.join(", ")),
          createdAt: sentAt,
          direction: "outbound",
          from: input.sender,
          fromNormalized: normalizeManagedSearchValue(input.sender),
          headers: input.headers ?? [],
          id,
          inReplyTo: null,
          isRead: true,
          mailboxId: senderMailbox.id,
          messageHeaderId: input.messageHeaderId ?? null,
          providerMessageId: input.providerMessageId,
          rawObjectBucket: input.rawObject?.bucket ?? null,
          rawObjectKey: input.rawObject?.key ?? null,
          rawObjectProvider: input.rawObject?.provider ?? null,
          rawSizeBytes: input.rawSizeBytes ?? null,
          references: null,
          replyTo: input.replyTo?.join(", ") ? input.replyTo.join(", ") : null,
          s3Bucket: null,
          s3Key: null,
          searchText: createManagedMessageSearchText(input),
          sentAt,
          snippet: (() => {
            const snippetSource =
              input.bodyText ||
              (input.bodyHtml?.replaceAll(/<[^>]+>/gu, " ") ?? "");
            const trimmedSnippet = snippetSource
              .replaceAll(/\s+/gu, " ")
              .trim()
              .slice(0, 240);
            return trimmedSnippet || null;
          })(),
          subject: input.subject || null,
          threadId: input.threadId ?? id,
          to: input.to.join(", "),
          toNormalized: normalizeManagedSearchValue(input.to.join(", ")),
          updatedAt: sentAt,
        })
        .onConflictDoNothing({
          target: [
            managedMailMessage.mailboxId,
            managedMailMessage.providerMessageId,
          ],
        })
        .returning({
          id: managedMailMessage.id,
          threadId: managedMailMessage.threadId,
        });

      if (inserted === undefined) {
        const [existing] = await tx
          .select({
            id: managedMailMessage.id,
            threadId: managedMailMessage.threadId,
          })
          .from(managedMailMessage)
          .where(
            and(
              eq(managedMailMessage.mailboxId, senderMailbox.id),
              eq(managedMailMessage.providerMessageId, input.providerMessageId)
            )
          )
          .limit(1);
        return existing ?? null;
      }

      if (input.attachments !== undefined && input.attachments.length > 0) {
        await tx.insert(managedMailAttachment).values(
          input.attachments.map((attachment) => ({
            contentId: attachment.contentId ?? null,
            createdAt: sentAt,
            fileName: attachment.fileName,
            id: randomUUID(),
            inline: attachment.inline,
            mailboxId: senderMailbox.id,
            messageId: inserted.id,
            mimeType: attachment.mimeType,
            normalizedFileName: normalizeManagedSearchValue(
              attachment.fileName
            ),
            partIndex: attachment.partIndex ?? null,
            size: attachment.size,
          }))
        );
      }
      const inheritedLabels = await tx
        .selectDistinct({ labelId: managedMailMessageLabel.labelId })
        .from(managedMailMessageLabel)
        .innerJoin(
          managedMailMessage,
          eq(managedMailMessage.id, managedMailMessageLabel.messageId)
        )
        .where(
          and(
            eq(managedMailMessage.mailboxId, senderMailbox.id),
            eq(managedMailMessage.threadId, inserted.threadId),
            ne(managedMailMessage.id, inserted.id)
          )
        );
      if (inheritedLabels.length > 0) {
        await tx
          .insert(managedMailMessageLabel)
          .values(
            inheritedLabels.map(({ labelId }) => ({
              assignedByUserId: null,
              createdAt: sentAt,
              id: randomUUID(),
              labelId,
              mailboxId: senderMailbox.id,
              messageId: inserted.id,
              ruleId: null,
              source: "inherited" as const,
            }))
          )
          .onConflictDoNothing({
            target: [
              managedMailMessageLabel.messageId,
              managedMailMessageLabel.labelId,
            ],
          });
      }
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, senderMailbox.id));
      return inserted;
    }
  );
};
