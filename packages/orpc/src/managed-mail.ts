import type { S3Client } from "@aws-sdk/client-s3";
import type { SESv2Client } from "@aws-sdk/client-sesv2";
import type { z } from "zod";
import { ORPCError } from "@orpc/server";
import {
  assertCanConsumeOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
  recordOrganizationMailUsage,
} from "@quieter/billing/organization-mail-usage";
import { db, mailbox, managedMailMessage } from "@quieter/database";
import {
  MAILBOX_LABELS,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageInspectorResult,
  type MessageListItem,
  type ThreadMessagesResult,
} from "@quieter/gmail";
import {
  buildMimeMessage,
  composeMessageInputSchema,
  extractMailAddress,
  splitMailAddressList,
} from "@quieter/mail/compose";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "./mailbox";
import {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "./organization-mail-policy";

type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;

const MANAGED_MESSAGE_PAGE_SIZE = 50;

const normalizeEmailAddress = (value: string) => value.trim().toLowerCase();

const getAwsRegion = () => {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (!region) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "AWS_REGION or AWS_DEFAULT_REGION is required to send mail.",
    });
  }
  return region;
};

let sesv2Client: SESv2Client | null = null;
let s3Client: S3Client | null = null;

const getSesv2Client = async (): Promise<SESv2Client> => {
  const { SESv2Client } = await import("@aws-sdk/client-sesv2");
  sesv2Client ??= new SESv2Client({ region: getAwsRegion() });
  return sesv2Client;
};

const getS3Client = async (): Promise<S3Client> => {
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3Client ??= new S3Client({ region: getAwsRegion() });
  return s3Client;
};

const toMessageListItem = async (
  record: typeof managedMailMessage.$inferSelect,
): Promise<MessageListItem> => ({
  bcc: record.bcc ?? undefined,
  bodyHtml: record.bodyHtml ?? undefined,
  bodyText: record.bodyText ?? undefined,
  cc: record.cc ?? undefined,
  date: record.sentAt.toISOString(),
  from: record.from,
  id: record.id,
  inReplyTo: record.inReplyTo ?? undefined,
  internalDate: String(record.sentAt.getTime()),
  isUnread: !record.isRead,
  labelIds: [
    record.direction === "inbound" ? MAILBOX_LABELS.inbox : MAILBOX_LABELS.sent,
    ...(!record.isRead ? [MAILBOX_LABELS.unread] : []),
  ],
  messageHeaderId: record.messageHeaderId ?? undefined,
  references: record.references ?? undefined,
  replyTo: record.replyTo ?? undefined,
  senderAvatarUrls: await getSenderAvatarUrls(record.from),
  snippet: record.snippet ?? undefined,
  subject: record.subject ?? undefined,
  threadId: record.threadId,
  to: record.to ?? undefined,
});

const getCategoryCondition = (category: MailboxCategory) => {
  if (category === "inbox") return eq(managedMailMessage.direction, "inbound");
  if (category === "unread") {
    return and(eq(managedMailMessage.direction, "inbound"), eq(managedMailMessage.isRead, false));
  }
  if (category === "sent") return eq(managedMailMessage.direction, "outbound");
  return null;
};

const parsePageOffset = (pageToken: string | undefined) => {
  const offset = Number.parseInt(pageToken ?? "0", 10);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

export const listManagedMessages = async (input: {
  category: MailboxCategory;
  mailboxId: string;
  maxResults?: number;
  pageToken?: string;
  query?: string;
  userId: string;
}): Promise<ListMessagesPageResult> => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });

  const categoryCondition = getCategoryCondition(input.category);
  if (!categoryCondition) {
    return { messages: [], resultSizeEstimate: 0 };
  }

  const query = input.query?.trim();
  const searchCondition = query
    ? or(
        ilike(managedMailMessage.subject, `%${query}%`),
        ilike(managedMailMessage.from, `%${query}%`),
        ilike(managedMailMessage.to, `%${query}%`),
        ilike(managedMailMessage.snippet, `%${query}%`),
        ilike(managedMailMessage.bodyText, `%${query}%`),
      )
    : undefined;
  const where = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    categoryCondition,
    searchCondition,
  );
  const offset = parsePageOffset(input.pageToken);
  const limit = Math.min(input.maxResults ?? MANAGED_MESSAGE_PAGE_SIZE, 100);
  const [records, countRows] = await Promise.all([
    db
      .select()
      .from(managedMailMessage)
      .where(where)
      .orderBy(desc(managedMailMessage.sentAt), desc(managedMailMessage.id))
      .limit(limit + 1)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(managedMailMessage)
      .where(where),
  ]);
  const hasNextPage = records.length > limit;
  const pageRecords = records.slice(0, limit);

  return {
    messages: await Promise.all(pageRecords.map(toMessageListItem)),
    nextPageToken: hasNextPage ? String(offset + limit) : undefined,
    resultSizeEstimate: Number(countRows[0]?.count ?? 0),
  };
};

export const getManagedThread = async (input: {
  mailboxId: string;
  threadId: string;
  userId: string;
}): Promise<ThreadMessagesResult> => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const records = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
      ),
    )
    .orderBy(asc(managedMailMessage.sentAt), asc(managedMailMessage.id));

  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }

  const messages = await Promise.all(records.map(toMessageListItem));
  return {
    messages,
    snippet: messages.at(-1)?.snippet,
    subject: messages.find((message) => message.subject)?.subject,
    threadId: input.threadId,
  };
};

export const getManagedMessageInspector = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}): Promise<MessageInspectorResult> => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const [record] = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.id, input.messageId),
        eq(managedMailMessage.mailboxId, input.mailboxId),
      ),
    )
    .limit(1);

  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }

  return {
    bcc: record.bcc ?? undefined,
    cc: record.cc ?? undefined,
    date: record.sentAt.toISOString(),
    from: record.from,
    headers: record.headers,
    id: record.id,
    internalDate: String(record.sentAt.getTime()),
    messageHeaderId: record.messageHeaderId ?? undefined,
    references: record.references ?? undefined,
    replyTo: record.replyTo ?? undefined,
    snippet: record.snippet ?? undefined,
    subject: record.subject ?? undefined,
    to: record.to ?? undefined,
  };
};

export const refreshManagedMessages = async (input: {
  mailboxId: string;
  messageIds: string[];
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const records = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        inArray(managedMailMessage.id, input.messageIds),
      ),
    );
  const recordsById = new Map(records.map((record) => [record.id, record]));

  return {
    removedMessageIds: input.messageIds.filter((messageId) => !recordsById.has(messageId)),
    updatedMessages: await Promise.all(records.map(toMessageListItem)),
  };
};

const getManagedMessageLabelIds = (direction: "inbound" | "outbound", read: boolean) => [
  direction === "inbound" ? MAILBOX_LABELS.inbox : MAILBOX_LABELS.sent,
  ...(!read ? [MAILBOX_LABELS.unread] : []),
];

export const setManagedMessageReadState = async (input: {
  mailboxId: string;
  messageId: string;
  read: boolean;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const [record] = await db
    .select({ direction: managedMailMessage.direction })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.id, input.messageId),
      ),
    )
    .limit(1);
  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }

  await db
    .update(managedMailMessage)
    .set({ isRead: input.read, updatedAt: new Date() })
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.id, input.messageId),
      ),
    );

  return {
    id: input.messageId,
    isUnread: !input.read,
    labelIds: getManagedMessageLabelIds(record.direction, input.read),
  };
};

export const setManagedThreadReadState = async (input: {
  mailboxId: string;
  read: boolean;
  threadId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });
  const records = await db
    .select({
      direction: managedMailMessage.direction,
      id: managedMailMessage.id,
    })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
      ),
    );
  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }

  await db
    .update(managedMailMessage)
    .set({ isRead: input.read, updatedAt: new Date() })
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
      ),
    );

  return {
    messages: records.map((record) => ({
      id: record.id,
      isUnread: !input.read,
      labelIds: getManagedMessageLabelIds(record.direction, input.read),
    })),
    threadId: input.threadId,
  };
};

const deleteManagedMailRecords = async (
  records: Array<{
    id: string;
    s3Bucket: string | null;
    s3Key: string | null;
  }>,
  condition: SQL,
) => {
  const objects = new Map<string, { bucket: string; key: string }>();

  for (const record of records) {
    if (record.s3Bucket && record.s3Key) {
      objects.set(`${record.s3Bucket}\0${record.s3Key}`, {
        bucket: record.s3Bucket,
        key: record.s3Key,
      });
    }
  }

  await db.delete(managedMailMessage).where(condition);

  for (const object of objects.values()) {
    const [otherReference] = await db
      .select({ id: managedMailMessage.id })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.s3Bucket, object.bucket),
          eq(managedMailMessage.s3Key, object.key),
        ),
      )
      .limit(1);

    if (!otherReference) {
      try {
        const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
        const client = await getS3Client();
        await client.send(
          new DeleteObjectCommand({
            Bucket: object.bucket,
            Key: object.key,
          }),
        );
      } catch (error) {
        console.error("Failed to delete managed mail object from S3.", {
          bucket: object.bucket,
          error,
          key: object.key,
        });
      }
    }
  }
};

export const deleteManagedMessage = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const condition = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    eq(managedMailMessage.id, input.messageId),
  )!;
  const records = await db
    .select({
      id: managedMailMessage.id,
      s3Bucket: managedMailMessage.s3Bucket,
      s3Key: managedMailMessage.s3Key,
    })
    .from(managedMailMessage)
    .where(condition);
  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }

  await deleteManagedMailRecords(records, condition);
  return {
    id: input.messageId,
    isUnread: false,
    labelIds: [],
  };
};

export const deleteManagedThread = async (input: {
  mailboxId: string;
  threadId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  const condition = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    eq(managedMailMessage.threadId, input.threadId),
  )!;
  const records = await db
    .select({
      id: managedMailMessage.id,
      s3Bucket: managedMailMessage.s3Bucket,
      s3Key: managedMailMessage.s3Key,
    })
    .from(managedMailMessage)
    .where(condition);
  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }

  await deleteManagedMailRecords(records, condition);
  return {
    messages: records.map((record) => ({
      id: record.id,
      isUnread: false,
      labelIds: [],
    })),
    threadId: input.threadId,
  };
};

export const recordOutboundManagedMessageForSender = async (input: {
  bcc?: string[];
  bodyHtml?: string;
  bodyText?: string;
  cc?: string[];
  messageHeaderId?: string;
  organizationId: string;
  providerMessageId: string;
  replyTo?: string[];
  sender: string;
  sentAt?: Date;
  subject: string;
  threadId?: string;
  to: string[];
}) => {
  const [senderMailbox] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.emailAddress, normalizeEmailAddress(input.sender)),
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, "managed"),
      ),
    )
    .limit(1);
  if (!senderMailbox) return null;

  const id = randomUUID();
  const sentAt = input.sentAt ?? new Date();
  const [inserted] = await db
    .insert(managedMailMessage)
    .values({
      bcc: input.bcc?.join(", ") || null,
      bodyHtml: input.bodyHtml ?? null,
      bodyText: input.bodyText ?? null,
      cc: input.cc?.join(", ") || null,
      createdAt: sentAt,
      direction: "outbound",
      from: input.sender,
      headers: [],
      id,
      inReplyTo: null,
      isRead: true,
      mailboxId: senderMailbox.id,
      messageHeaderId: input.messageHeaderId ?? null,
      providerMessageId: input.providerMessageId,
      rawSizeBytes: null,
      references: null,
      replyTo: input.replyTo?.join(", ") || null,
      s3Bucket: null,
      s3Key: null,
      sentAt,
      snippet:
        (input.bodyText ?? input.bodyHtml?.replaceAll(/<[^>]+>/g, " "))
          ?.replaceAll(/\s+/g, " ")
          .trim()
          .slice(0, 240) || null,
      subject: input.subject || null,
      threadId: input.threadId ?? id,
      to: input.to.join(", "),
      updatedAt: sentAt,
    })
    .onConflictDoNothing({
      target: [managedMailMessage.mailboxId, managedMailMessage.providerMessageId],
    })
    .returning({ id: managedMailMessage.id, threadId: managedMailMessage.threadId });

  return inserted ?? null;
};

export const sendManagedMailboxMessage = async (input: {
  mailboxId: string;
  message: ComposeMessageInput;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["responder", "manager"],
    userId: input.userId,
  });
  if (!selectedMailbox.organizationId) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Managed mailbox organization is missing.",
    });
  }
  const organizationId = selectedMailbox.organizationId;

  const to = splitMailAddressList(input.message.recipients.to).map(extractMailAddress);
  const cc = splitMailAddressList(input.message.recipients.cc).map(extractMailAddress);
  const bcc = splitMailAddressList(input.message.recipients.bcc).map(extractMailAddress);
  const attachmentSizeBytes = [...input.message.attachments, ...input.message.inlineImages].reduce(
    (total, attachment) => total + attachment.size,
    0,
  );
  const usageEstimate = estimateOutboundOrganizationMailUsage({
    attachmentSizeBytes,
    bcc,
    cc,
    html: input.message.bodyHtml,
    subject: input.message.subject,
    text: input.message.bodyText,
    to,
  });

  try {
    await assertCanConsumeOrganizationMailUsage({
      estimate: usageEstimate,
      organizationId,
    });
    await assertOrganizationOwnsVerifiedSenderDomain({
      organizationId,
      sender: selectedMailbox.emailAddress,
    });
  } catch (error) {
    if (error instanceof OrganizationMailSendError) {
      throw new ORPCError(error.status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR", {
        message: error.message,
        status: error.status,
      });
    }
    throw error;
  }

  const sentAt = new Date();
  const domain = selectedMailbox.emailAddress.split("@").at(1);
  if (!domain) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Managed mailbox address is invalid.",
    });
  }
  const messageHeaderId = `<${randomUUID()}@${domain}>`;
  const rawMessage = await buildMimeMessage(input.message, {
    from: selectedMailbox.emailAddress,
    messageId: messageHeaderId,
    omitBccHeader: true,
    sentAt,
  });
  const { SendEmailCommand } = await import("@aws-sdk/client-sesv2");
  const client = await getSesv2Client();
  const response = await client.send(
    new SendEmailCommand({
      Content: {
        Raw: {
          Data: new TextEncoder().encode(rawMessage),
        },
      },
      Destination: {
        BccAddresses: bcc,
        CcAddresses: cc,
        ToAddresses: to,
      },
      FromEmailAddress: selectedMailbox.emailAddress,
      ReplyToAddresses: [selectedMailbox.emailAddress],
    }),
  );
  const providerMessageId = response.MessageId;
  if (!providerMessageId) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "SES accepted the message without returning a message id.",
    });
  }

  const persistSendRecord = async () => {
    try {
      return await recordOutboundManagedMessageForSender({
        bcc,
        bodyHtml: input.message.bodyHtml,
        bodyText: input.message.bodyText,
        cc,
        messageHeaderId,
        organizationId,
        providerMessageId,
        replyTo: [selectedMailbox.emailAddress],
        sender: selectedMailbox.emailAddress,
        sentAt,
        subject: input.message.subject,
        threadId: input.message.replyContext?.threadId,
        to,
      });
    } catch (error) {
      console.error("Failed to persist outbound managed message after send.", {
        error,
        mailboxId: selectedMailbox.id,
        providerMessageId,
      });
      return null;
    }
  };

  const persistUsage = async () => {
    try {
      await recordOrganizationMailUsage({
        ...usageEstimate,
        metadata: {
          mailboxId: selectedMailbox.id,
          sender: selectedMailbox.emailAddress,
        },
        organizationId,
        providerMessageId,
      });
    } catch (error) {
      console.error("Failed to record organization mail usage after send.", {
        error,
        mailboxId: selectedMailbox.id,
        providerMessageId,
      });
    }
  };

  const [savedMessage] = await Promise.all([persistSendRecord(), persistUsage()]);

  return {
    id: savedMessage?.id ?? providerMessageId,
    messageId: providerMessageId,
    threadId: savedMessage?.threadId ?? input.message.replyContext?.threadId ?? providerMessageId,
  };
};
