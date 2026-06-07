import { db, mailbox, managedMailMessage } from "@quieter/database";
import { parseRawMailMessage, type ParsedRawMailMessage } from "@quieter/mail/raw-message";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const normalizeEmailAddress = (value: string) => value.trim().toLowerCase();

const getReplyReferenceIds = (message: ParsedRawMailMessage) =>
  Array.from(
    new Set(
      [message.inReplyTo, ...(message.references?.match(/<[^>]+>/g) ?? [])]
        .map((value) => value?.trim())
        .filter((value): value is string => !!value),
    ),
  );

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

  return referencedMessage?.threadId ?? fallbackThreadId;
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
    const threadId = await resolveManagedThreadId(targetMailbox.id, parsed, id);
    const [inserted] = await db
      .insert(managedMailMessage)
      .values({
        bcc: parsed.bcc ?? null,
        bodyHtml: parsed.bodyHtml ?? null,
        bodyText: parsed.bodyText ?? null,
        cc: parsed.cc ?? null,
        createdAt: new Date(),
        direction: "inbound",
        from: parsed.from,
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
        sentAt,
        snippet: parsed.snippet ?? null,
        subject: parsed.subject ?? null,
        threadId,
        to: parsed.to ?? recipients.join(", "),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [managedMailMessage.mailboxId, managedMailMessage.providerMessageId],
      })
      .returning({ mailboxId: managedMailMessage.mailboxId });

    if (inserted) insertedMailboxIds.push(inserted.mailboxId);
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
