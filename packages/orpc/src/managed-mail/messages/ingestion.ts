import { createHash, randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  mailbox,
  mailDomain,
  managedMailAttachment,
  managedMailMessage,
} from "@quieter/database/schema";
import { parseRawMailMessage } from "@quieter/mail/raw-message";
import type { ParsedRawMailMessage } from "@quieter/mail/raw-message";
import { reportError } from "@quieter/observability";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { enqueueMailboxActionsForMessage } from "../../mailbox-actions/enqueue";
import { hasText } from "../../text";
import { processManagedMailAutomation } from "../automation";
import { inheritManagedThreadLabels } from "../labels/repository";
import { applyManagedRulesToMessage } from "../rules/evaluator";
import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
} from "../search/normalization";

type RawMailObjectProvider = "r2" | "s3";

const normalizeEmailAddress = (value: string) => value.trim().toLowerCase();

const getReplyReferenceIds = (message: ParsedRawMailMessage) => [
  ...new Set(
    [message.inReplyTo, ...(message.references?.match(/<[^>]+>/gu) ?? [])]
      .map((value) => value?.trim())
      .filter((value): value is string => hasText(value))
  ),
];

const deriveThreadId = (mailboxId: string, canonicalRef: string) =>
  createHash("sha256")
    .update(`${mailboxId}\0${canonicalRef}`)
    .digest("hex")
    .slice(0, 32);

const resolveManagedThreadId = async (
  mailboxId: string,
  message: ParsedRawMailMessage,
  fallbackThreadId: string
) => {
  const referenceIds = getReplyReferenceIds(message);
  if (referenceIds.length === 0) {
    return fallbackThreadId;
  }

  const [referencedMessage] = await db
    .select({ threadId: managedMailMessage.threadId })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, mailboxId),
        inArray(managedMailMessage.messageHeaderId, referenceIds)
      )
    )
    .orderBy(desc(managedMailMessage.sentAt))
    .limit(1);

  return (
    referencedMessage?.threadId ?? deriveThreadId(mailboxId, referenceIds[0])
  );
};

const runPostIngestionOrganization = async (input: {
  mailboxId: string;
  messageId: string;
  providerMessageId: string;
  threadId: string;
}) => {
  try {
    await inheritManagedThreadLabels({
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      threadId: input.threadId,
    });
    await applyManagedRulesToMessage({
      mailboxId: input.mailboxId,
      messageId: input.messageId,
    });
    await processManagedMailAutomation({
      mailboxId: input.mailboxId,
      messageId: input.messageId,
    });
    await enqueueMailboxActionsForMessage({
      mailboxId: input.mailboxId,
      sourceMessageId: input.providerMessageId,
      sourceThreadId: input.threadId,
    });
  } catch (error) {
    reportError(error, { operation: "managed-mail:organize-after-ingestion" });
  }
};

const ingestManagedMessageForMailbox = async (input: {
  parsed: ParsedRawMailMessage;
  providerMessageId: string;
  rawObjectBucket: string;
  rawObjectKey: string;
  rawObjectProvider: RawMailObjectProvider;
  rawSizeBytes: number;
  receivedAt: Date;
  recipients: string[];
  s3Bucket?: string;
  s3Key?: string;
  targetMailboxId: string;
}) => {
  const id = randomUUID();
  const sentAt = input.parsed.date ?? input.receivedAt;
  const canonicalRef = input.parsed.messageHeaderId ?? id;
  const threadId = await resolveManagedThreadId(
    input.targetMailboxId,
    input.parsed,
    deriveThreadId(input.targetMailboxId, canonicalRef)
  );
  const inserted = await db.transaction(async (tx) => {
    const [message] = await tx
      .insert(managedMailMessage)
      .values({
        bcc: input.parsed.bcc ?? null,
        bccNormalized: normalizeManagedSearchValue(input.parsed.bcc),
        bodyHtml: input.parsed.bodyHtml ?? null,
        bodyText: input.parsed.bodyText ?? null,
        cc: input.parsed.cc ?? null,
        ccNormalized: normalizeManagedSearchValue(input.parsed.cc),
        createdAt: new Date(),
        direction: "inbound",
        from: input.parsed.from,
        fromNormalized: normalizeManagedSearchValue(input.parsed.from),
        headers: input.parsed.headers,
        id,
        inReplyTo: input.parsed.inReplyTo ?? null,
        isRead: false,
        mailboxId: input.targetMailboxId,
        messageHeaderId: input.parsed.messageHeaderId ?? null,
        providerMessageId: input.providerMessageId,
        rawObjectBucket: input.rawObjectBucket,
        rawObjectKey: input.rawObjectKey,
        rawObjectProvider: input.rawObjectProvider,
        rawSizeBytes: input.rawSizeBytes,
        references: input.parsed.references ?? null,
        replyTo: input.parsed.replyTo ?? null,
        s3Bucket:
          input.rawObjectProvider === "s3"
            ? input.rawObjectBucket
            : (input.s3Bucket ?? null),
        s3Key:
          input.rawObjectProvider === "s3"
            ? input.rawObjectKey
            : (input.s3Key ?? null),
        searchText: createManagedMessageSearchText(input.parsed),
        sentAt,
        snippet: input.parsed.snippet ?? null,
        subject: input.parsed.subject ?? null,
        threadId,
        to: input.parsed.to ?? input.recipients.join(", "),
        toNormalized: normalizeManagedSearchValue(
          input.parsed.to ?? input.recipients.join(", ")
        ),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          managedMailMessage.mailboxId,
          managedMailMessage.providerMessageId,
        ],
      })
      .returning({
        id: managedMailMessage.id,
        mailboxId: managedMailMessage.mailboxId,
        threadId: managedMailMessage.threadId,
      });

    if (message !== undefined && input.parsed.attachments.length > 0) {
      await tx.insert(managedMailAttachment).values(
        input.parsed.attachments.map((attachment, partIndex) => ({
          contentId: attachment.contentId ?? null,
          createdAt: new Date(),
          fileName: attachment.fileName,
          id: randomUUID(),
          inline: attachment.inline,
          mailboxId: message.mailboxId,
          messageId: message.id,
          mimeType: attachment.mimeType,
          normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
          partIndex,
          size: attachment.size,
        }))
      );
    }

    if (message !== undefined) {
      await tx
        .update(mailbox)
        .set({
          contentRevision: sql`${mailbox.contentRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mailbox.id, input.targetMailboxId));
    }

    return message;
  });

  if (inserted !== undefined) {
    await runPostIngestionOrganization({
      mailboxId: inserted.mailboxId,
      messageId: inserted.id,
      providerMessageId: input.providerMessageId,
      threadId: inserted.threadId,
    });
    return inserted.mailboxId;
  }

  const [existing] = await db
    .select({
      id: managedMailMessage.id,
      threadId: managedMailMessage.threadId,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.targetMailboxId),
        eq(managedMailMessage.providerMessageId, input.providerMessageId)
      )
    )
    .limit(1);
  if (existing !== undefined) {
    await Promise.all([
      inheritManagedThreadLabels({
        mailboxId: input.targetMailboxId,
        messageId: existing.id,
        threadId: existing.threadId,
      }),
      applyManagedRulesToMessage({
        mailboxId: input.targetMailboxId,
        messageId: existing.id,
      }),
    ]);
  }
  return null;
};

const isValidInboundRecipient = (recipient: string) => {
  const separatorIndex = recipient.indexOf("@");
  return (
    separatorIndex > 0 &&
    separatorIndex < recipient.length - 1 &&
    !recipient.slice(separatorIndex + 1).includes("@") &&
    !/\s/u.test(recipient)
  );
};

export const resolveInboundManagedTargetMailboxIds = async (
  recipients: string[]
): Promise<string[]> => {
  const exactTargets = await db
    .select({ emailAddress: mailbox.emailAddress, id: mailbox.id })
    .from(mailbox)
    .innerJoin(
      mailDomain,
      and(
        eq(mailDomain.organizationId, mailbox.organizationId),
        eq(mailDomain.mode, "send_and_receive"),
        eq(mailDomain.status, "verified"),
        sql`lower(split_part(${mailbox.emailAddress}, '@', 2)) = ${mailDomain.domain}`
      )
    )
    .where(
      and(
        eq(mailbox.provider, "managed"),
        inArray(mailbox.emailAddress, recipients)
      )
    );

  const targetMailboxIds = new Set(exactTargets.map((target) => target.id));
  const exactlyMatchedRecipients = new Set(
    exactTargets.map((target) => normalizeEmailAddress(target.emailAddress))
  );
  const catchAllDomains = [
    ...new Set(
      recipients
        .filter(
          (recipient) =>
            !exactlyMatchedRecipients.has(recipient) &&
            isValidInboundRecipient(recipient)
        )
        .map((recipient) => recipient.split("@")[1])
    ),
  ];
  if (catchAllDomains.length === 0) {
    return [...targetMailboxIds];
  }

  const catchAllTargets = await db
    .select({ domain: mailDomain.domain, id: mailbox.id })
    .from(mailDomain)
    .innerJoin(mailbox, eq(mailbox.id, mailDomain.catchAllMailboxId))
    .where(
      and(
        eq(mailDomain.mode, "send_and_receive"),
        eq(mailDomain.status, "verified"),
        eq(mailbox.provider, "managed"),
        eq(mailbox.organizationId, mailDomain.organizationId),
        inArray(mailDomain.domain, catchAllDomains)
      )
    );
  if (catchAllTargets.length === 0) {
    return [...targetMailboxIds];
  }

  const catchAllMailboxIdByDomain = new Map(
    catchAllTargets.map((target) => [target.domain, target.id])
  );
  for (const recipient of recipients) {
    if (exactlyMatchedRecipients.has(recipient)) {
      continue;
    }
    const catchAllMailboxId = catchAllMailboxIdByDomain.get(
      recipient.split("@")[1] ?? ""
    );
    if (catchAllMailboxId !== undefined) {
      targetMailboxIds.add(catchAllMailboxId);
    }
  }

  return [...targetMailboxIds];
};

export const recordInboundManagedMessage = async (input: {
  providerMessageId: string;
  rawMessage: Buffer | Uint8Array;
  rawObjectBucket?: string;
  rawObjectKey?: string;
  rawObjectProvider?: RawMailObjectProvider;
  rawSizeBytes: number;
  receivedAt: Date;
  recipients: string[];
  s3Bucket?: string;
  s3Key?: string;
}) => {
  const recipients = [
    ...new Set(
      input.recipients
        .map(normalizeEmailAddress)
        .filter((value) => hasText(value))
    ),
  ];
  if (recipients.length === 0) {
    return [];
  }

  const targetMailboxIds =
    await resolveInboundManagedTargetMailboxIds(recipients);
  if (targetMailboxIds.length === 0) {
    return [];
  }

  const parsed = await parseRawMailMessage(input.rawMessage);
  const rawObjectProvider = input.rawObjectProvider ?? "s3";
  const rawObjectBucket = input.rawObjectBucket ?? input.s3Bucket;
  const rawObjectKey = input.rawObjectKey ?? input.s3Key;
  if (!hasText(rawObjectBucket) || !hasText(rawObjectKey)) {
    throw new Error(
      "Inbound managed mail requires a canonical raw object reference."
    );
  }

  const ingestResults = await Promise.all(
    targetMailboxIds.map(
      async (targetMailboxId) =>
        await ingestManagedMessageForMailbox({
          parsed,
          providerMessageId: input.providerMessageId,
          rawObjectBucket,
          rawObjectKey,
          rawObjectProvider,
          rawSizeBytes: input.rawSizeBytes,
          receivedAt: input.receivedAt,
          recipients,
          s3Bucket: input.s3Bucket,
          s3Key: input.s3Key,
          targetMailboxId,
        })
    )
  );
  const insertedMailboxIds = ingestResults.filter(
    (mailboxId): mailboxId is string => mailboxId !== null
  );

  return insertedMailboxIds;
};

export const hasManagedMailObjectReference = async (input: {
  s3Bucket: string;
  s3Key: string;
}) => {
  const [reference] = await db
    .select({ id: managedMailMessage.id })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.s3Bucket, input.s3Bucket),
        eq(managedMailMessage.s3Key, input.s3Key)
      )
    )
    .limit(1);

  return reference !== undefined;
};

export const hasManagedRawMailObjectReference = async (input: {
  bucket: string;
  key: string;
  provider: RawMailObjectProvider;
}) => {
  const [reference] = await db
    .select({ id: managedMailMessage.id })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.rawObjectProvider, input.provider),
        eq(managedMailMessage.rawObjectBucket, input.bucket),
        eq(managedMailMessage.rawObjectKey, input.key)
      )
    )
    .limit(1);

  return reference !== undefined;
};
