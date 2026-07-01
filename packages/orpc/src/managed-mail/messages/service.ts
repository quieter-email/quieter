import type { SESv2Client } from "@aws-sdk/client-sesv2";
import type { SendHeader } from "@quieter/mail/send";
import type { z } from "zod";
import { ORPCError } from "@orpc/server";
import {
  assertCanConsumeOrganizationMailUsage,
  estimateOutboundOrganizationMailUsage,
  recordOrganizationMailUsage,
} from "@quieter/billing/organization-mail-usage";
import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailMessage,
  managedMailMessageLabel,
  type ManagedMailMailboxState,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import {
  MAILBOX_LABELS,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageInspectorResult,
  type MessageListItem,
  type ThreadMessagesResult,
} from "@quieter/gmail";
import { buildMimeMessage } from "@quieter/mail/compose/mime";
import {
  composeMessageInputSchema,
  extractMailAddress,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { and, asc, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "../../organization-mail-policy";
import { inheritManagedThreadLabels } from "../labels/repository";
import { createManagedSearchCondition } from "../search/compiler";
import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
  parseManagedSearchQuery,
} from "../search/normalization";

type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;

const MANAGED_MESSAGE_PAGE_SIZE = 50;

const normalizeEmailAddress = (value: string) => value.trim().toLowerCase();

const getManagedSystemLabelIds = (message: {
  direction: "inbound" | "outbound";
  isRead: boolean;
  mailboxState: ManagedMailMailboxState;
}) => [
  message.mailboxState === "trash"
    ? MAILBOX_LABELS.trash
    : message.mailboxState === "spam"
      ? MAILBOX_LABELS.spam
      : message.direction === "inbound"
        ? MAILBOX_LABELS.inbox
        : MAILBOX_LABELS.sent,
  ...(!message.isRead ? [MAILBOX_LABELS.unread] : []),
];

export const getManagedMessageLabelIds = (
  message: {
    direction: "inbound" | "outbound";
    isRead: boolean;
    mailboxState: ManagedMailMailboxState;
  },
  customLabelIds: string[] = [],
) => [...getManagedSystemLabelIds(message), ...customLabelIds];

const getAwsRegion = () => {
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;
  if (!region) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Mail sending is temporarily unavailable.",
    });
  }
  return region;
};

let sesv2Client: SESv2Client | null = null;

const getSesv2Client = async (): Promise<SESv2Client> => {
  const { SESv2Client } = await import("@aws-sdk/client-sesv2");
  sesv2Client ??= new SESv2Client({ region: getAwsRegion() });
  return sesv2Client;
};

const toMessageListItem = async (
  record: typeof managedMailMessage.$inferSelect,
  options: {
    attachmentCount?: number;
    labelIds?: string[];
    threadMessageCount?: number;
  } = {},
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
  labelIds: getManagedMessageLabelIds(record, options.labelIds),
  messageHeaderId: record.messageHeaderId ?? undefined,
  references: record.references ?? undefined,
  replyTo: record.replyTo ?? undefined,
  senderAvatarUrls: await getSenderAvatarUrls(record.from),
  snippet: record.snippet ?? undefined,
  subject: record.subject ?? undefined,
  threadAttachmentCount: options.attachmentCount,
  threadId: record.threadId,
  threadMessageCount: options.threadMessageCount,
  to: record.to ?? undefined,
});

const getCategoryCondition = (category: MailboxCategory) => {
  if (category === "inbox") {
    return and(
      eq(managedMailMessage.direction, "inbound"),
      eq(managedMailMessage.mailboxState, "active"),
    );
  }
  if (category === "unread") {
    return and(
      eq(managedMailMessage.direction, "inbound"),
      eq(managedMailMessage.isRead, false),
      eq(managedMailMessage.mailboxState, "active"),
    );
  }
  if (category === "sent") {
    return and(
      eq(managedMailMessage.direction, "outbound"),
      eq(managedMailMessage.mailboxState, "active"),
    );
  }
  if (category === "spam") return eq(managedMailMessage.mailboxState, "spam");
  if (category === "trash") return eq(managedMailMessage.mailboxState, "trash");
  return null;
};

const parseManagedPageCursor = (pageToken: string | undefined) => {
  if (!pageToken) return null;
  try {
    const parsed = JSON.parse(Buffer.from(pageToken, "base64url").toString("utf8")) as {
      id?: unknown;
      sentAt?: unknown;
    };
    if (typeof parsed.id !== "string" || typeof parsed.sentAt !== "string") {
      throw new Error("Invalid cursor shape.");
    }
    const sentAt = new Date(parsed.sentAt);
    if (Number.isNaN(sentAt.getTime())) {
      throw new Error("Invalid cursor date.");
    }
    return { id: parsed.id, sentAt };
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "The message page token is invalid.",
    });
  }
};

const encodeManagedPageCursor = (record: { id: string; sentAt: Date }) =>
  Buffer.from(JSON.stringify({ id: record.id, sentAt: record.sentAt.toISOString() })).toString(
    "base64url",
  );

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

  const search = parseManagedSearchQuery(input.query);
  const searchCondition = createManagedSearchCondition(input.mailboxId, search);
  const where = and(
    eq(managedMailMessage.mailboxId, input.mailboxId),
    categoryCondition,
    searchCondition,
  );
  const limit = Math.min(input.maxResults ?? MANAGED_MESSAGE_PAGE_SIZE, 100);
  const matchedMessages = db
    .selectDistinctOn([managedMailMessage.threadId])
    .from(managedMailMessage)
    .where(where)
    .orderBy(
      managedMailMessage.threadId,
      desc(managedMailMessage.sentAt),
      desc(managedMailMessage.id),
    )
    .as("matched_messages");
  const cursor = parseManagedPageCursor(input.pageToken);
  const cursorCondition = cursor
    ? or(
        lt(matchedMessages.sentAt, cursor.sentAt),
        and(eq(matchedMessages.sentAt, cursor.sentAt), lt(matchedMessages.id, cursor.id)),
      )
    : undefined;
  const [records, countRows] = await Promise.all([
    db
      .select()
      .from(matchedMessages)
      .where(cursorCondition)
      .orderBy(desc(matchedMessages.sentAt), desc(matchedMessages.id))
      .limit(limit + 1),
    db
      .select({ count: sql<number>`count(distinct ${managedMailMessage.threadId})` })
      .from(managedMailMessage)
      .where(where),
  ]);
  const hasNextPage = records.length > limit;
  const pageRecords = records.slice(0, limit);
  const threadIds = pageRecords.map((record) => record.threadId);
  const [assignments, messageCounts, attachmentCounts] =
    threadIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .selectDistinct({
              labelId: managedMailMessageLabel.labelId,
              threadId: managedMailMessage.threadId,
            })
            .from(managedMailMessageLabel)
            .innerJoin(
              managedMailMessage,
              eq(managedMailMessage.id, managedMailMessageLabel.messageId),
            )
            .where(
              and(
                eq(managedMailMessage.mailboxId, input.mailboxId),
                inArray(managedMailMessage.threadId, threadIds),
              ),
            ),
          db
            .select({ count: count(), threadId: managedMailMessage.threadId })
            .from(managedMailMessage)
            .where(
              and(
                eq(managedMailMessage.mailboxId, input.mailboxId),
                inArray(managedMailMessage.threadId, threadIds),
              ),
            )
            .groupBy(managedMailMessage.threadId),
          db
            .select({
              count: count(),
              threadId: managedMailMessage.threadId,
            })
            .from(managedMailAttachment)
            .innerJoin(
              managedMailMessage,
              eq(managedMailMessage.id, managedMailAttachment.messageId),
            )
            .where(
              and(
                eq(managedMailAttachment.mailboxId, input.mailboxId),
                inArray(managedMailMessage.threadId, threadIds),
              ),
            )
            .groupBy(managedMailMessage.threadId),
        ]);
  const labelIdsByThreadId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const labelIds = labelIdsByThreadId.get(assignment.threadId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByThreadId.set(assignment.threadId, labelIds);
  }
  const messageCountByThreadId = new Map(
    messageCounts.map((record) => [record.threadId, Number(record.count)]),
  );
  const attachmentCountByThreadId = new Map(
    attachmentCounts.map((record) => [record.threadId, Number(record.count)]),
  );

  return {
    messages: await Promise.all(
      pageRecords.map((record) =>
        toMessageListItem(record, {
          attachmentCount: attachmentCountByThreadId.get(record.threadId) ?? 0,
          labelIds: labelIdsByThreadId.get(record.threadId) ?? [],
          threadMessageCount: messageCountByThreadId.get(record.threadId) ?? 1,
        }),
      ),
    ),
    nextPageToken:
      hasNextPage && pageRecords.length > 0
        ? encodeManagedPageCursor(pageRecords[pageRecords.length - 1])
        : undefined,
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

  const [assignments, attachmentCounts] = await Promise.all([
    db
      .select({
        labelId: managedMailMessageLabel.labelId,
        messageId: managedMailMessageLabel.messageId,
      })
      .from(managedMailMessageLabel)
      .where(
        and(
          eq(managedMailMessageLabel.mailboxId, input.mailboxId),
          inArray(
            managedMailMessageLabel.messageId,
            records.map((record) => record.id),
          ),
        ),
      ),
    db
      .select({ count: count(), messageId: managedMailAttachment.messageId })
      .from(managedMailAttachment)
      .where(
        inArray(
          managedMailAttachment.messageId,
          records.map((record) => record.id),
        ),
      )
      .groupBy(managedMailAttachment.messageId),
  ]);
  const labelIdsByMessageId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const labelIds = labelIdsByMessageId.get(assignment.messageId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByMessageId.set(assignment.messageId, labelIds);
  }
  const attachmentCountByMessageId = new Map(
    attachmentCounts.map((record) => [record.messageId, Number(record.count)]),
  );
  const messages = await Promise.all(
    records.map((record) =>
      toMessageListItem(record, {
        attachmentCount: attachmentCountByMessageId.get(record.id) ?? 0,
        labelIds: labelIdsByMessageId.get(record.id) ?? [],
        threadMessageCount: records.length,
      }),
    ),
  );
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
  const assignments =
    records.length > 0
      ? await db
          .select({
            labelId: managedMailMessageLabel.labelId,
            messageId: managedMailMessageLabel.messageId,
          })
          .from(managedMailMessageLabel)
          .where(
            inArray(
              managedMailMessageLabel.messageId,
              records.map((record) => record.id),
            ),
          )
      : [];
  const labelIdsByMessageId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const labelIds = labelIdsByMessageId.get(assignment.messageId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByMessageId.set(assignment.messageId, labelIds);
  }

  return {
    removedMessageIds: input.messageIds.filter((messageId) => !recordsById.has(messageId)),
    updatedMessages: await Promise.all(
      records.map((record) =>
        toMessageListItem(record, { labelIds: labelIdsByMessageId.get(record.id) ?? [] }),
      ),
    ),
  };
};

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
    .select({
      direction: managedMailMessage.direction,
      mailboxState: managedMailMessage.mailboxState,
    })
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
  const customLabels = await db
    .select({ labelId: managedMailMessageLabel.labelId })
    .from(managedMailMessageLabel)
    .where(eq(managedMailMessageLabel.messageId, input.messageId));

  return {
    id: input.messageId,
    isUnread: !input.read,
    labelIds: getManagedMessageLabelIds(
      { ...record, isRead: input.read },
      customLabels.map((assignment) => assignment.labelId),
    ),
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
      mailboxState: managedMailMessage.mailboxState,
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
  const customLabels = await db
    .select({
      labelId: managedMailMessageLabel.labelId,
      messageId: managedMailMessageLabel.messageId,
    })
    .from(managedMailMessageLabel)
    .where(
      inArray(
        managedMailMessageLabel.messageId,
        records.map((record) => record.id),
      ),
    );
  const labelIdsByMessageId = new Map<string, string[]>();
  for (const assignment of customLabels) {
    const labelIds = labelIdsByMessageId.get(assignment.messageId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByMessageId.set(assignment.messageId, labelIds);
  }

  return {
    messages: records.map((record) => ({
      id: record.id,
      isUnread: !input.read,
      labelIds: getManagedMessageLabelIds(
        { ...record, isRead: input.read },
        labelIdsByMessageId.get(record.id) ?? [],
      ),
    })),
    threadId: input.threadId,
  };
};

export const setManagedMessageMailboxState = async (input: {
  mailboxId: string;
  messageId: string;
  state: ManagedMailMailboxState;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager", "responder"],
    userId: input.userId,
  });
  const [record] = await db
    .select({
      direction: managedMailMessage.direction,
      id: managedMailMessage.id,
      isRead: managedMailMessage.isRead,
    })
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
    .set({ mailboxState: input.state, updatedAt: new Date() })
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.id, input.messageId),
      ),
    );
  const customLabels = await db
    .select({ labelId: managedMailMessageLabel.labelId })
    .from(managedMailMessageLabel)
    .where(eq(managedMailMessageLabel.messageId, input.messageId));

  return {
    id: input.messageId,
    isUnread: !record.isRead,
    labelIds: getManagedMessageLabelIds(
      { ...record, mailboxState: input.state },
      customLabels.map((assignment) => assignment.labelId),
    ),
  };
};

export const setManagedThreadMailboxState = async (input: {
  mailboxId: string;
  state: ManagedMailMailboxState;
  threadId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager", "responder"],
    userId: input.userId,
  });
  const records = await db
    .select({
      direction: managedMailMessage.direction,
      id: managedMailMessage.id,
      isRead: managedMailMessage.isRead,
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
    .set({ mailboxState: input.state, updatedAt: new Date() })
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.threadId, input.threadId),
      ),
    );
  const customLabels = await db
    .select({
      labelId: managedMailMessageLabel.labelId,
      messageId: managedMailMessageLabel.messageId,
    })
    .from(managedMailMessageLabel)
    .where(
      inArray(
        managedMailMessageLabel.messageId,
        records.map((record) => record.id),
      ),
    );
  const labelIdsByMessageId = new Map<string, string[]>();
  for (const assignment of customLabels) {
    const labelIds = labelIdsByMessageId.get(assignment.messageId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByMessageId.set(assignment.messageId, labelIds);
  }

  return {
    messages: records.map((record) => ({
      id: record.id,
      isUnread: !record.isRead,
      labelIds: getManagedMessageLabelIds(
        { ...record, mailboxState: input.state },
        labelIdsByMessageId.get(record.id) ?? [],
      ),
    })),
    threadId: input.threadId,
  };
};

export const recordOutboundManagedMessageForSender = async (input: {
  attachments?: Array<{
    contentId?: string | null;
    fileName: string;
    inline: boolean;
    mimeType: string;
    size: number;
  }>;
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
  requireApiSentMessageInclusion?: boolean;
  sender: string;
  senderAddress?: string;
  sentAt?: Date;
  subject: string;
  threadId?: string;
  to: string[];
}) => {
  const senderAddress = normalizeEmailAddress(
    input.senderAddress ?? extractMailAddress(input.sender),
  );
  const [senderMailbox] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.emailAddress, senderAddress),
        eq(mailbox.organizationId, input.organizationId),
        eq(mailbox.provider, "managed"),
        input.requireApiSentMessageInclusion ? eq(mailbox.includeApiSentMessages, true) : undefined,
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
      bccNormalized: normalizeManagedSearchValue(input.bcc?.join(", ")),
      bodyHtml: input.bodyHtml ?? null,
      bodyText: input.bodyText ?? null,
      cc: input.cc?.join(", ") || null,
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
      rawSizeBytes: input.rawSizeBytes ?? null,
      references: null,
      replyTo: input.replyTo?.join(", ") || null,
      s3Bucket: null,
      s3Key: null,
      searchText: createManagedMessageSearchText(input),
      sentAt,
      snippet:
        (input.bodyText ?? input.bodyHtml?.replaceAll(/<[^>]+>/g, " "))
          ?.replaceAll(/\s+/g, " ")
          .trim()
          .slice(0, 240) || null,
      subject: input.subject || null,
      threadId: input.threadId ?? id,
      to: input.to.join(", "),
      toNormalized: normalizeManagedSearchValue(input.to.join(", ")),
      updatedAt: sentAt,
    })
    .onConflictDoNothing({
      target: [managedMailMessage.mailboxId, managedMailMessage.providerMessageId],
    })
    .returning({ id: managedMailMessage.id, threadId: managedMailMessage.threadId });

  if (!inserted) return null;

  if (input.attachments?.length) {
    await db.insert(managedMailAttachment).values(
      input.attachments.map((attachment) => ({
        contentId: attachment.contentId ?? null,
        createdAt: sentAt,
        fileName: attachment.fileName,
        id: randomUUID(),
        inline: attachment.inline,
        mailboxId: senderMailbox.id,
        messageId: inserted.id,
        mimeType: attachment.mimeType,
        normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
        size: attachment.size,
      })),
    );
  }
  await inheritManagedThreadLabels({
    mailboxId: senderMailbox.id,
    messageId: inserted.id,
    threadId: inserted.threadId,
  });
  return inserted;
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
      message: "Managed mailbox team is missing.",
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
      message: "The message was accepted, but no delivery reference was returned.",
    });
  }

  const persistSendRecord = async () => {
    try {
      return await recordOutboundManagedMessageForSender({
        attachments: [
          ...input.message.attachments.map((attachment) => ({
            contentId: attachment.contentId,
            fileName: attachment.fileName ?? attachment.name,
            inline: false,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })),
          ...input.message.inlineImages.map((attachment) => ({
            contentId: attachment.contentId,
            fileName: attachment.name,
            inline: true,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })),
        ],
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
      console.error("Failed to record team mail usage after send.", {
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
