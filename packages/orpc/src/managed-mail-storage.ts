import { db, mailbox, managedMailAttachment, managedMailMessage } from "@quieter/database";
import { parseRawMailMessage, type ParsedRawMailMessage } from "@quieter/mail/raw-message";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  applyManagedRulesToMessage,
  inheritManagedThreadLabels,
} from "./managed-mail-organization";
import { createManagedMessageSearchText, normalizeManagedSearchValue } from "./managed-mail-search";

const normalizeEmailAddress = (value: string) => value.trim().toLowerCase();

const getReplyReferenceIds = (message: ParsedRawMailMessage) =>
  Array.from(
    new Set(
      [message.inReplyTo, ...(message.references?.match(/<[^>]+>/g) ?? [])]
        .map((value) => value?.trim())
        .filter((value): value is string => !!value),
    ),
  );

const deriveThreadId = (mailboxId: string, canonicalRef: string) =>
  createHash("sha256").update(`${mailboxId}\0${canonicalRef}`).digest("hex").slice(0, 32);

const resolveManagedThreadId = async (
  mailboxId: string,
  message: ParsedRawMailMessage,
  fallbackThreadId: string,
) => {
  const referenceIds = getReplyReferenceIds(message);
  if (referenceIds.length === 0) return fallbackThreadId;

  const [referencedMessage] = await db
    .select({ threadId: managedMailMessage.threadId })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, mailboxId),
        inArray(managedMailMessage.messageHeaderId, referenceIds),
      ),
    )
    .orderBy(desc(managedMailMessage.sentAt))
    .limit(1);

  return referencedMessage?.threadId ?? deriveThreadId(mailboxId, referenceIds[0]);
};

export const recordInboundManagedMessage = async (input: {
  providerMessageId: string;
  rawMessage: Buffer | Uint8Array;
  rawSizeBytes: number;
  receivedAt: Date;
  recipients: string[];
  s3Bucket: string;
  s3Key: string;
}) => {
  const recipients = Array.from(
    new Set(input.recipients.map(normalizeEmailAddress).filter(Boolean)),
  );
  if (recipients.length === 0) return [];

  const targetMailboxes = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(and(eq(mailbox.provider, "managed"), inArray(mailbox.emailAddress, recipients)));
  if (targetMailboxes.length === 0) return [];

  const parsed = await parseRawMailMessage(input.rawMessage);
  const insertedMailboxIds: string[] = [];

  for (const targetMailbox of targetMailboxes) {
    const id = randomUUID();
    const sentAt = parsed.date ?? input.receivedAt;
    const canonicalRef = parsed.messageHeaderId ?? id;
    const threadId = await resolveManagedThreadId(
      targetMailbox.id,
      parsed,
      deriveThreadId(targetMailbox.id, canonicalRef),
    );
    const [inserted] = await db
      .insert(managedMailMessage)
      .values({
        bcc: parsed.bcc ?? null,
        bccNormalized: normalizeManagedSearchValue(parsed.bcc),
        bodyHtml: parsed.bodyHtml ?? null,
        bodyText: parsed.bodyText ?? null,
        cc: parsed.cc ?? null,
        ccNormalized: normalizeManagedSearchValue(parsed.cc),
        createdAt: new Date(),
        direction: "inbound",
        from: parsed.from,
        fromNormalized: normalizeManagedSearchValue(parsed.from),
        headers: parsed.headers,
        id,
        inReplyTo: parsed.inReplyTo ?? null,
        isRead: false,
        mailboxId: targetMailbox.id,
        messageHeaderId: parsed.messageHeaderId ?? null,
        providerMessageId: input.providerMessageId,
        rawSizeBytes: input.rawSizeBytes,
        references: parsed.references ?? null,
        replyTo: parsed.replyTo ?? null,
        s3Bucket: input.s3Bucket,
        s3Key: input.s3Key,
        searchText: createManagedMessageSearchText(parsed),
        sentAt,
        snippet: parsed.snippet ?? null,
        subject: parsed.subject ?? null,
        threadId,
        to: parsed.to ?? recipients.join(", "),
        toNormalized: normalizeManagedSearchValue(parsed.to ?? recipients.join(", ")),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [managedMailMessage.mailboxId, managedMailMessage.providerMessageId],
      })
      .returning({
        id: managedMailMessage.id,
        mailboxId: managedMailMessage.mailboxId,
        threadId: managedMailMessage.threadId,
      });

    if (inserted) {
      if (parsed.attachments.length > 0) {
        await db.insert(managedMailAttachment).values(
          parsed.attachments.map((attachment) => ({
            contentId: attachment.contentId ?? null,
            createdAt: new Date(),
            fileName: attachment.fileName,
            id: randomUUID(),
            inline: attachment.inline,
            mailboxId: inserted.mailboxId,
            messageId: inserted.id,
            mimeType: attachment.mimeType,
            normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
            size: attachment.size,
          })),
        );
      }
      try {
        await inheritManagedThreadLabels({
          mailboxId: inserted.mailboxId,
          messageId: inserted.id,
          threadId: inserted.threadId,
        });
        await applyManagedRulesToMessage({
          mailboxId: inserted.mailboxId,
          messageId: inserted.id,
        });
      } catch (error) {
        console.error("Managed message organization failed after ingestion.", {
          error,
          mailboxId: inserted.mailboxId,
          messageId: inserted.id,
        });
      }
      insertedMailboxIds.push(inserted.mailboxId);
    } else {
      const [existing] = await db
        .select({ id: managedMailMessage.id })
        .from(managedMailMessage)
        .where(
          and(
            eq(managedMailMessage.mailboxId, targetMailbox.id),
            eq(managedMailMessage.providerMessageId, input.providerMessageId),
          ),
        )
        .limit(1);
      if (existing) {
        await applyManagedRulesToMessage({
          mailboxId: targetMailbox.id,
          messageId: existing.id,
        });
      }
    }
  }

  return insertedMailboxIds;
};

export const hasManagedMailObjectReference = async (input: { s3Bucket: string; s3Key: string }) => {
  const [reference] = await db
    .select({ id: managedMailMessage.id })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.s3Bucket, input.s3Bucket),
        eq(managedMailMessage.s3Key, input.s3Key),
      ),
    )
    .limit(1);

  return !!reference;
};
