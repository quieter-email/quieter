import type { SESv2Client } from "@aws-sdk/client-sesv2";
import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
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
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  type ManagedMailHeader,
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
import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import { buildMimeMessage } from "@quieter/mail/compose/mime";
import {
  composeDraftInputSchema,
  composeMessageInputSchema,
  extractMailAddress,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import { QUIETER_DRAFT_HEADER_NAMES } from "@quieter/mail/compose/schema";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { and, asc, count, countDistinct, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "../../organization-mail-policy";
import { createManagedSearchCondition } from "../search/compiler";
import {
  createManagedMessageSearchText,
  normalizeManagedSearchValue,
  parseManagedSearchQuery,
} from "../search/normalization";

type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;
type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;

type ManagedMessagePresentationRecord = Pick<
  typeof managedMailMessage.$inferSelect,
  | "bcc"
  | "cc"
  | "direction"
  | "from"
  | "headers"
  | "id"
  | "inReplyTo"
  | "isRead"
  | "mailboxState"
  | "messageHeaderId"
  | "providerMessageId"
  | "references"
  | "replyTo"
  | "sentAt"
  | "snippet"
  | "subject"
  | "threadId"
  | "to"
> &
  Partial<Pick<typeof managedMailMessage.$inferSelect, "bodyHtml" | "bodyText">>;

const MANAGED_MESSAGE_PAGE_SIZE = 15;

const normalizeEmailAddress = (value: string) => value.trim().toLowerCase();

const getManagedSystemLabelIds = (message: {
  direction: "inbound" | "outbound";
  isRead: boolean;
  mailboxState: ManagedMailMailboxState;
}) => [
  message.mailboxState === "draft"
    ? MAILBOX_LABELS.drafts
    : message.mailboxState === "archived"
      ? MAILBOX_LABELS.archive
      : message.mailboxState === "trash"
        ? MAILBOX_LABELS.trash
        : message.mailboxState === "spam"
          ? MAILBOX_LABELS.spam
          : message.direction === "inbound"
            ? MAILBOX_LABELS.inbox
            : MAILBOX_LABELS.sent,
  ...(!message.isRead ? [MAILBOX_LABELS.unread] : []),
];

const getManagedHeader = (headers: ManagedMailHeader[], name: string) =>
  headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;

const getManagedDraftHeaders = (draft: ComposeDraftInput): ManagedMailHeader[] => {
  if (!draft.draftAnchor) return [];

  return [
    {
      name: QUIETER_DRAFT_HEADER_NAMES.sourceMessageId,
      value: draft.draftAnchor.sourceMessageId,
    },
    {
      name: QUIETER_DRAFT_HEADER_NAMES.sourceThreadId,
      value: draft.draftAnchor.sourceThreadId,
    },
    {
      name: QUIETER_DRAFT_HEADER_NAMES.seededBy,
      value: draft.draftAnchor.seededBy,
    },
    ...(draft.draftAnchor.sourceMessageHeaderId?.trim()
      ? [
          {
            name: QUIETER_DRAFT_HEADER_NAMES.sourceMessageHeaderId,
            value: draft.draftAnchor.sourceMessageHeaderId.trim(),
          },
        ]
      : []),
  ];
};

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
  record: ManagedMessagePresentationRecord,
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
  draftAnchor: parseDraftAnchorFromHeaderReader((name) => getManagedHeader(record.headers, name)),
  draftId: record.mailboxState === "draft" ? record.providerMessageId : undefined,
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
  if (category === "archive") return eq(managedMailMessage.mailboxState, "archived");
  if (category === "sent") {
    return and(
      eq(managedMailMessage.direction, "outbound"),
      eq(managedMailMessage.mailboxState, "active"),
    );
  }
  if (category === "drafts") return eq(managedMailMessage.mailboxState, "draft");
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
  const selectedMailbox = await getAuthorizedManagedMailbox({
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
    .selectDistinctOn([managedMailMessage.threadId], {
      bcc: managedMailMessage.bcc,
      cc: managedMailMessage.cc,
      direction: managedMailMessage.direction,
      from: managedMailMessage.from,
      headers: managedMailMessage.headers,
      id: managedMailMessage.id,
      inReplyTo: managedMailMessage.inReplyTo,
      isRead: managedMailMessage.isRead,
      mailboxState: managedMailMessage.mailboxState,
      messageHeaderId: managedMailMessage.messageHeaderId,
      providerMessageId: managedMailMessage.providerMessageId,
      references: managedMailMessage.references,
      replyTo: managedMailMessage.replyTo,
      sentAt: managedMailMessage.sentAt,
      snippet: managedMailMessage.snippet,
      subject: managedMailMessage.subject,
      threadId: managedMailMessage.threadId,
      to: managedMailMessage.to,
    })
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
  const records = await db
    .select()
    .from(matchedMessages)
    .where(cursorCondition)
    .orderBy(desc(matchedMessages.sentAt), desc(matchedMessages.id))
    .limit(limit + 1);
  const hasNextPage = records.length > limit;
  const pageRecords = records.slice(0, limit);
  const threadIds = pageRecords.map((record) => record.threadId);
  const aggregates =
    threadIds.length === 0
      ? []
      : await db
          .select({
            attachmentCount: countDistinct(managedMailAttachment.id),
            labelIds: sql<
              string[]
            >`coalesce(array_agg(distinct ${managedMailMessageLabel.labelId}) filter (where ${managedMailMessageLabel.labelId} is not null), '{}')`,
            messageCount: countDistinct(managedMailMessage.id),
            threadId: managedMailMessage.threadId,
          })
          .from(managedMailMessage)
          .leftJoin(
            managedMailMessageLabel,
            eq(managedMailMessage.id, managedMailMessageLabel.messageId),
          )
          .leftJoin(
            managedMailAttachment,
            eq(managedMailMessage.id, managedMailAttachment.messageId),
          )
          .where(
            and(
              eq(managedMailMessage.mailboxId, input.mailboxId),
              inArray(managedMailMessage.threadId, threadIds),
            ),
          )
          .groupBy(managedMailMessage.threadId);
  const labelIdsByThreadId = new Map<string, string[]>();
  for (const aggregate of aggregates) {
    labelIdsByThreadId.set(aggregate.threadId, aggregate.labelIds);
  }
  const messageCountByThreadId = new Map(
    aggregates.map((record) => [record.threadId, Number(record.messageCount)]),
  );
  const attachmentCountByThreadId = new Map(
    aggregates.map((record) => [record.threadId, Number(record.attachmentCount)]),
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
    historyId: String(selectedMailbox.contentRevision),
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

export const saveManagedDraft = async (input: {
  draft: ComposeDraftInput;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["responder", "manager"],
    userId: input.userId,
  });
  const draftId = input.draft.draftId?.trim() || randomUUID();
  const messageId = input.draft.messageId?.trim() || randomUUID();
  const now = new Date();
  const snippet =
    (input.draft.bodyText || input.draft.bodyHtml.replaceAll(/<[^>]+>/g, " "))
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 240) ||
    input.draft.subject.trim() ||
    null;
  const existingDraft = input.draft.draftId
    ? await db
        .select({ id: managedMailMessage.id, threadId: managedMailMessage.threadId })
        .from(managedMailMessage)
        .where(
          and(
            eq(managedMailMessage.mailboxId, input.mailboxId),
            eq(managedMailMessage.providerMessageId, draftId),
            eq(managedMailMessage.mailboxState, "draft"),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null;
  const resolvedMessageId = existingDraft?.id ?? messageId;
  const threadId =
    input.draft.replyContext?.threadId?.trim() ||
    input.draft.draftAnchor?.sourceThreadId?.trim() ||
    existingDraft?.threadId ||
    resolvedMessageId;
  const draftValues = {
    bcc: input.draft.recipients.bcc || null,
    bccNormalized: normalizeManagedSearchValue(input.draft.recipients.bcc),
    bodyHtml: input.draft.bodyHtml || null,
    bodyText: input.draft.bodyText || null,
    cc: input.draft.recipients.cc || null,
    ccNormalized: normalizeManagedSearchValue(input.draft.recipients.cc),
    from: selectedMailbox.emailAddress,
    fromNormalized: normalizeManagedSearchValue(selectedMailbox.emailAddress),
    headers: getManagedDraftHeaders(input.draft),
    inReplyTo: input.draft.replyContext?.messageHeaderId ?? null,
    isRead: true,
    mailboxState: "draft" as const,
    rawSizeBytes: null,
    references: input.draft.replyContext?.references.join(" ") || null,
    replyTo: selectedMailbox.emailAddress,
    searchText: createManagedMessageSearchText({
      bodyText: input.draft.bodyText,
      snippet,
      subject: input.draft.subject,
    }),
    sentAt: now,
    snippet,
    subject: input.draft.subject || null,
    threadId,
    to: input.draft.recipients.to || null,
    toNormalized: normalizeManagedSearchValue(input.draft.recipients.to),
    updatedAt: now,
  };

  await db.transaction(async (tx) => {
    if (existingDraft) {
      await tx
        .update(managedMailMessage)
        .set(draftValues)
        .where(
          and(
            eq(managedMailMessage.id, resolvedMessageId),
            eq(managedMailMessage.mailboxId, input.mailboxId),
            eq(managedMailMessage.mailboxState, "draft"),
          ),
        );
    } else {
      await tx.insert(managedMailMessage).values({
        ...draftValues,
        createdAt: now,
        direction: "outbound",
        id: resolvedMessageId,
        mailboxId: input.mailboxId,
        messageHeaderId: null,
        providerMessageId: draftId,
      });
    }

    await tx
      .delete(managedMailAttachment)
      .where(eq(managedMailAttachment.messageId, resolvedMessageId));

    const attachments = [
      ...input.draft.attachments.map((attachment) => ({
        contentId: null,
        fileName: attachment.fileName ?? attachment.name,
        inline: false,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      ...input.draft.inlineImages.map((attachment) => ({
        contentId: attachment.contentId,
        fileName: attachment.name,
        inline: true,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
    ];

    if (attachments.length > 0) {
      await tx.insert(managedMailAttachment).values(
        attachments.map((attachment) => ({
          contentId: attachment.contentId,
          createdAt: now,
          fileName: attachment.fileName,
          id: randomUUID(),
          inline: attachment.inline,
          mailboxId: input.mailboxId,
          messageId: resolvedMessageId,
          mimeType: attachment.mimeType,
          normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
          size: attachment.size,
        })),
      );
    }
    await tx
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: now })
      .where(eq(mailbox.id, input.mailboxId));
  });

  return {
    bodyHtml: input.draft.bodyHtml,
    bodyText: input.draft.bodyText,
    draftAnchor: input.draft.draftAnchor ?? null,
    draftId,
    messageId: resolvedMessageId,
    recipients: input.draft.recipients,
    replyContext: input.draft.replyContext ?? null,
    subject: input.draft.subject,
  };
};

export const deleteManagedDraft = async (input: {
  draftId: string;
  mailboxId: string;
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["responder", "manager"],
    userId: input.userId,
  });

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.providerMessageId, input.draftId),
          eq(managedMailMessage.mailboxState, "draft"),
        ),
      )
      .returning({ id: managedMailMessage.id });
    if (deleted.length > 0) {
      await tx
        .update(mailbox)
        .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
        .where(eq(mailbox.id, input.mailboxId));
    }
  });

  return { deleted: true };
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

  await db.transaction(async (tx) => {
    await tx
      .update(managedMailMessage)
      .set({ isRead: input.read, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.id, input.messageId),
        ),
      );
    await tx
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
      .where(eq(mailbox.id, input.mailboxId));
  });
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

export const applyManagedMessageChanges = async (input: {
  command: MailCommand;
  mailboxId: string;
  targets: MailMutationTarget[];
  userId: string;
}) => {
  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager", "responder"],
    userId: input.userId,
  });
  const messageIds = Array.from(
    new Set(
      input.targets
        .flatMap((target) => target.messageIds)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
  if (messageIds.length === 0) {
    return { revision: null, targets: [] };
  }

  return await db.transaction(async (tx) => {
    const records = await tx
      .select({ id: managedMailMessage.id, threadId: managedMailMessage.threadId })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          inArray(managedMailMessage.id, messageIds),
        ),
      );
    const threadIdByMessageId = new Map(records.map((record) => [record.id, record.threadId]));
    const validTargets = input.targets.filter((target) =>
      target.messageIds.every(
        (messageId) => threadIdByMessageId.get(messageId) === target.threadId,
      ),
    );
    const appliedMessageIds = Array.from(
      new Set(validTargets.flatMap((target) => target.messageIds)),
    );
    const targets = input.targets.map((target) => ({
      status: (validTargets.includes(target) ? "applied" : "failed") as "applied" | "failed",
      threadId: target.threadId,
    }));
    if (appliedMessageIds.length === 0) {
      return { revision: null, targets };
    }
    const baseCondition = and(
      eq(managedMailMessage.mailboxId, input.mailboxId),
      inArray(managedMailMessage.id, appliedMessageIds),
    );

    if (input.command.kind === "set-read") {
      await tx
        .update(managedMailMessage)
        .set({ isRead: input.command.read, updatedAt: new Date() })
        .where(baseCondition);
    } else if (input.command.kind === "move") {
      const mailboxState =
        input.command.destination === "inbox"
          ? "active"
          : input.command.destination === "archive"
            ? "archived"
            : input.command.destination;
      await tx
        .update(managedMailMessage)
        .set({ mailboxState, updatedAt: new Date() })
        .where(
          and(
            baseCondition,
            input.command.destination === "archive"
              ? ne(managedMailMessage.mailboxState, "draft")
              : undefined,
          ),
        );
    } else if (input.command.kind === "set-labels") {
      const labelIds = Array.from(new Set([...input.command.addIds, ...input.command.removeIds]));
      if (labelIds.length > 0) {
        const labels = await tx
          .select({ id: managedMailLabel.id })
          .from(managedMailLabel)
          .where(
            and(
              eq(managedMailLabel.mailboxId, input.mailboxId),
              inArray(managedMailLabel.id, labelIds),
            ),
          );
        if (labels.length !== labelIds.length) {
          throw new ORPCError("BAD_REQUEST", {
            message: "One or more labels are unavailable.",
          });
        }
      }
      if (input.command.removeIds.length > 0) {
        await tx
          .delete(managedMailMessageLabel)
          .where(
            and(
              eq(managedMailMessageLabel.mailboxId, input.mailboxId),
              inArray(managedMailMessageLabel.messageId, appliedMessageIds),
              inArray(managedMailMessageLabel.labelId, input.command.removeIds),
            ),
          );
      }
      if (input.command.addIds.length > 0) {
        await tx
          .insert(managedMailMessageLabel)
          .values(
            appliedMessageIds.flatMap((messageId) =>
              input.command.kind === "set-labels"
                ? input.command.addIds.map((labelId) => ({
                    assignedByUserId: input.userId,
                    createdAt: new Date(),
                    id: randomUUID(),
                    labelId,
                    mailboxId: input.mailboxId,
                    messageId,
                    ruleId: null,
                    source: "manual" as const,
                  }))
                : [],
            ),
          )
          .onConflictDoNothing({
            target: [managedMailMessageLabel.messageId, managedMailMessageLabel.labelId],
          });
      }
    } else {
      throw new ORPCError("BAD_REQUEST", {
        message: "This bulk action is not supported for managed mailboxes.",
      });
    }

    const [updatedMailbox] = await tx
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
      .where(eq(mailbox.id, input.mailboxId))
      .returning({ contentRevision: mailbox.contentRevision });
    return {
      revision: updatedMailbox?.contentRevision ?? null,
      targets,
    };
  });
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

  await db.transaction(async (tx) => {
    await tx
      .update(managedMailMessage)
      .set({ isRead: input.read, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.threadId, input.threadId),
        ),
      );
    await tx
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
      .where(eq(mailbox.id, input.mailboxId));
  });
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

  await db.transaction(async (tx) => {
    await tx
      .update(managedMailMessage)
      .set({ mailboxState: input.state, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.id, input.messageId),
        ),
      );
    await tx
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
      .where(eq(mailbox.id, input.mailboxId));
  });
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
  const stateCondition =
    input.state === "archived" ? ne(managedMailMessage.mailboxState, "draft") : undefined;
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
        stateCondition,
      ),
    );
  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(managedMailMessage)
      .set({ mailboxState: input.state, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.threadId, input.threadId),
          stateCondition,
        ),
      );
    await tx
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
      .where(eq(mailbox.id, input.mailboxId));
  });
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
  return await db.transaction(async (tx) => {
    const [inserted] = await tx
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
          normalizedFileName: normalizeManagedSearchValue(attachment.fileName),
          size: attachment.size,
        })),
      );
    }
    const inheritedLabels = await tx
      .selectDistinct({ labelId: managedMailMessageLabel.labelId })
      .from(managedMailMessageLabel)
      .innerJoin(managedMailMessage, eq(managedMailMessage.id, managedMailMessageLabel.messageId))
      .where(
        and(
          eq(managedMailMessage.mailboxId, senderMailbox.id),
          eq(managedMailMessage.threadId, inserted.threadId),
          ne(managedMailMessage.id, inserted.id),
        ),
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
          })),
        )
        .onConflictDoNothing({
          target: [managedMailMessageLabel.messageId, managedMailMessageLabel.labelId],
        });
    }
    await tx
      .update(mailbox)
      .set({ contentRevision: sql`${mailbox.contentRevision} + 1`, updatedAt: new Date() })
      .where(eq(mailbox.id, senderMailbox.id));
    return inserted;
  });
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
