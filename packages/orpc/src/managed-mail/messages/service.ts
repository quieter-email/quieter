import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
  organizationMailDeliveryRecipient,
} from "@quieter/database/schema";
import type {
  ManagedMailHeader,
  ManagedMailMailboxState,
} from "@quieter/database/schema";
import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import type {
  ListMessagesPageResult,
  MailboxCategory,
  MessageInspectorResult,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/mail/messages";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  inArray,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../../mailbox/access";
import {
  getOrganizationMailDelivery,
  groupDeliveryStatusesByMessage,
} from "../../organization-mail-delivery";
import { createManagedSearchCondition } from "../search/compiler";
import { parseManagedSearchQuery } from "../search/normalization";

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
  Partial<
    Pick<typeof managedMailMessage.$inferSelect, "bodyHtml" | "bodyText">
  >;

const MANAGED_MESSAGE_PAGE_SIZE = 15;

const getManagedPrimarySystemLabelId = (message: {
  direction: "inbound" | "outbound";
  mailboxState: ManagedMailMailboxState;
}) => {
  if (message.mailboxState === "draft") {
    return MAILBOX_LABELS.drafts;
  }
  if (message.mailboxState === "archived") {
    return MAILBOX_LABELS.archive;
  }
  if (message.mailboxState === "trash") {
    return MAILBOX_LABELS.trash;
  }
  if (message.mailboxState === "spam") {
    return MAILBOX_LABELS.spam;
  }
  return message.direction === "inbound"
    ? MAILBOX_LABELS.inbox
    : MAILBOX_LABELS.sent;
};

const getManagedSystemLabelIds = (message: {
  direction: "inbound" | "outbound";
  isRead: boolean;
  mailboxState: ManagedMailMailboxState;
}) => [
  getManagedPrimarySystemLabelId(message),
  ...(message.isRead ? [] : [MAILBOX_LABELS.unread]),
];

const getManagedHeader = (headers: ManagedMailHeader[], name: string) =>
  headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
    ?.value;

export const getManagedMessageLabelIds = (
  message: {
    direction: "inbound" | "outbound";
    isRead: boolean;
    mailboxState: ManagedMailMailboxState;
  },
  customLabelIds: string[] = []
) => [...getManagedSystemLabelIds(message), ...customLabelIds];

const toMessageListItem = async (
  record: ManagedMessagePresentationRecord,
  options: {
    attachments?: MessageListItem["attachments"];
    attachmentCount?: number;
    labelIds?: string[];
    threadLabelIds?: string[];
    threadMessageCount?: number;
  } = {}
): Promise<MessageListItem> => ({
  attachments: options.attachments,
  bcc: record.bcc ?? undefined,
  bodyHtml: record.bodyHtml ?? undefined,
  bodyText: record.bodyText ?? undefined,
  cc: record.cc ?? undefined,
  date: record.sentAt.toISOString(),
  draftAnchor: parseDraftAnchorFromHeaderReader((name) =>
    getManagedHeader(record.headers, name)
  ),
  draftId:
    record.mailboxState === "draft" ? record.providerMessageId : undefined,
  from: record.from,
  id: record.id,
  inReplyTo: record.inReplyTo ?? undefined,
  internalDate: String(record.sentAt.getTime()),
  isUnread: !record.isRead,
  labelIds: getManagedMessageLabelIds(record, options.labelIds),
  messageHeaderId: record.messageHeaderId ?? undefined,
  references: record.references ?? undefined,
  replyTo: record.replyTo ?? undefined,
  senderAvatarUrls: await getSenderAvatarUrls(record.from, {
    headers: record.direction === "inbound" ? record.headers : [],
  }),
  snippet: record.snippet ?? undefined,
  subject: record.subject ?? undefined,
  threadAttachmentCount: options.attachmentCount,
  threadId: record.threadId,
  threadLabelIds: options.threadLabelIds,
  threadMessageCount: options.threadMessageCount,
  to: record.to ?? undefined,
});

const getCategoryCondition = (category: MailboxCategory) => {
  if (category === "inbox") {
    return and(
      eq(managedMailMessage.direction, "inbound"),
      eq(managedMailMessage.mailboxState, "active")
    );
  }
  if (category === "unread") {
    return and(
      eq(managedMailMessage.direction, "inbound"),
      eq(managedMailMessage.isRead, false),
      eq(managedMailMessage.mailboxState, "active")
    );
  }
  if (category === "archive") {
    return eq(managedMailMessage.mailboxState, "archived");
  }
  if (category === "sent") {
    return and(
      eq(managedMailMessage.direction, "outbound"),
      eq(managedMailMessage.mailboxState, "active")
    );
  }
  if (category === "drafts") {
    return eq(managedMailMessage.mailboxState, "draft");
  }
  if (category === "spam") {
    return eq(managedMailMessage.mailboxState, "spam");
  }
  if (category === "trash") {
    return eq(managedMailMessage.mailboxState, "trash");
  }
  return null;
};

const parseManagedPageCursor = (pageToken: string | undefined) => {
  if (!pageToken) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(pageToken, "base64url").toString("utf-8")
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      !("sentAt" in parsed)
    ) {
      throw new TypeError("Invalid cursor shape.");
    }
    const { id, sentAt: sentAtValue } = parsed;
    if (typeof id !== "string" || typeof sentAtValue !== "string") {
      throw new TypeError("Invalid cursor shape.");
    }
    const sentAt = new Date(sentAtValue);
    if (Number.isNaN(sentAt.getTime())) {
      throw new TypeError("Invalid cursor date.");
    }
    return { id, sentAt };
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "The message page token is invalid.",
    });
  }
};

const encodeManagedPageCursor = (record: { id: string; sentAt: Date }) =>
  Buffer.from(
    JSON.stringify({ id: record.id, sentAt: record.sentAt.toISOString() })
  ).toString("base64url");

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
    searchCondition
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
      desc(managedMailMessage.id)
    )
    .as("matched_messages");
  const cursor = parseManagedPageCursor(input.pageToken);
  const cursorCondition = cursor
    ? or(
        lt(matchedMessages.sentAt, cursor.sentAt),
        and(
          eq(matchedMessages.sentAt, cursor.sentAt),
          lt(matchedMessages.id, cursor.id)
        )
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
  const [aggregates, threadStates] =
    threadIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
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
              eq(managedMailMessage.id, managedMailMessageLabel.messageId)
            )
            .leftJoin(
              managedMailAttachment,
              eq(managedMailMessage.id, managedMailAttachment.messageId)
            )
            .where(
              and(
                eq(managedMailMessage.mailboxId, input.mailboxId),
                inArray(managedMailMessage.threadId, threadIds)
              )
            )
            .groupBy(managedMailMessage.threadId),
          db
            .select({
              direction: managedMailMessage.direction,
              isRead: managedMailMessage.isRead,
              mailboxState: managedMailMessage.mailboxState,
              threadId: managedMailMessage.threadId,
            })
            .from(managedMailMessage)
            .where(
              and(
                eq(managedMailMessage.mailboxId, input.mailboxId),
                inArray(managedMailMessage.threadId, threadIds)
              )
            ),
        ]);
  const labelIdsByThreadId = new Map<string, string[]>();
  const threadLabelIdsByThreadId = new Map<string, Set<string>>();
  for (const aggregate of aggregates) {
    labelIdsByThreadId.set(aggregate.threadId, aggregate.labelIds);
    threadLabelIdsByThreadId.set(
      aggregate.threadId,
      new Set(aggregate.labelIds)
    );
  }
  for (const state of threadStates) {
    const labelIds =
      threadLabelIdsByThreadId.get(state.threadId) ?? new Set<string>();
    for (const labelId of getManagedSystemLabelIds(state)) {
      labelIds.add(labelId);
    }
    threadLabelIdsByThreadId.set(state.threadId, labelIds);
  }
  const messageCountByThreadId = new Map(
    aggregates.map((record) => [record.threadId, record.messageCount])
  );
  const attachmentCountByThreadId = new Map(
    aggregates.map((record) => [record.threadId, record.attachmentCount])
  );

  return {
    historyId: String(selectedMailbox.contentRevision),
    messages: await Promise.all(
      pageRecords.map(
        async (record) =>
          await toMessageListItem(record, {
            attachmentCount:
              attachmentCountByThreadId.get(record.threadId) ?? 0,
            labelIds: labelIdsByThreadId.get(record.threadId) ?? [],
            threadLabelIds: [
              ...(threadLabelIdsByThreadId.get(record.threadId) ?? []),
            ],
            threadMessageCount:
              messageCountByThreadId.get(record.threadId) ?? 1,
          })
      )
    ),
    nextPageToken: (() => {
      const lastRecord = pageRecords.at(-1);
      return hasNextPage && lastRecord !== undefined
        ? encodeManagedPageCursor(lastRecord)
        : undefined;
    })(),
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
        eq(managedMailMessage.threadId, input.threadId)
      )
    )
    .orderBy(asc(managedMailMessage.sentAt), asc(managedMailMessage.id));

  if (records.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Message thread not found." });
  }

  const [assignments, attachments] = await Promise.all([
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
            records.map((record) => record.id)
          )
        )
      ),
    db
      .select()
      .from(managedMailAttachment)
      .where(
        and(
          eq(managedMailAttachment.mailboxId, input.mailboxId),
          inArray(
            managedMailAttachment.messageId,
            records.map((record) => record.id)
          )
        )
      ),
  ]);
  const labelIdsByMessageId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const labelIds = labelIdsByMessageId.get(assignment.messageId) ?? [];
    labelIds.push(assignment.labelId);
    labelIdsByMessageId.set(assignment.messageId, labelIds);
  }
  const attachmentsByMessageId = new Map<
    string,
    NonNullable<MessageListItem["attachments"]>
  >();
  for (const attachment of attachments) {
    const messageAttachments =
      attachmentsByMessageId.get(attachment.messageId) ?? [];
    messageAttachments.push({
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    });
    attachmentsByMessageId.set(attachment.messageId, messageAttachments);
  }
  const messages = await Promise.all(
    records.map(
      async (record) =>
        await toMessageListItem(record, {
          attachmentCount: attachmentsByMessageId.get(record.id)?.length ?? 0,
          attachments: attachmentsByMessageId.get(record.id) ?? [],
          labelIds: labelIdsByMessageId.get(record.id) ?? [],
          threadMessageCount: records.length,
        })
    )
  );
  const threadLabelIds = [
    ...new Set(messages.flatMap((message) => message.labelIds ?? [])),
  ];
  return {
    messages: messages.map((message) => ({ ...message, threadLabelIds })),
    snippet: messages.at(-1)?.snippet,
    subject: messages.find((message) => !!message.subject)?.subject,
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
        eq(managedMailMessage.mailboxId, input.mailboxId)
      )
    )
    .limit(1);

  if (record === undefined) {
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

const resolveManagedMoveMailboxState = (
  destination: "archive" | "inbox" | "spam" | "trash"
): ManagedMailMailboxState => {
  if (destination === "inbox") {
    return "active";
  }
  if (destination === "archive") {
    return "archived";
  }
  return destination;
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
        eq(managedMailMessage.id, input.messageId)
      )
    )
    .limit(1);
  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(managedMailMessage)
      .set({ isRead: input.read, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.id, input.messageId)
        )
      );
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
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
      customLabels.map((assignment) => assignment.labelId)
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
  const messageIds = [
    ...new Set(
      input.targets
        .flatMap((target) => target.messageIds)
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
  if (messageIds.length === 0) {
    return { revision: null, targets: [] };
  }

  return await db.transaction(async (tx) => {
    const records = await tx
      .select({
        id: managedMailMessage.id,
        threadId: managedMailMessage.threadId,
      })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          inArray(managedMailMessage.id, messageIds)
        )
      );
    const threadIdByMessageId = new Map(
      records.map((record) => [record.id, record.threadId])
    );
    const validTargets = input.targets.filter((target) =>
      target.messageIds.every(
        (messageId) => threadIdByMessageId.get(messageId) === target.threadId
      )
    );
    const appliedMessageIds = [
      ...new Set(validTargets.flatMap((target) => target.messageIds)),
    ];
    const targets = input.targets.map((target) => ({
      status: validTargets.includes(target) ? "applied" : "failed",
      threadId: target.threadId,
    }));
    if (appliedMessageIds.length === 0) {
      return { revision: null, targets };
    }
    const baseCondition = and(
      eq(managedMailMessage.mailboxId, input.mailboxId),
      inArray(managedMailMessage.id, appliedMessageIds)
    );

    if (input.command.kind === "set-read") {
      await tx
        .update(managedMailMessage)
        .set({ isRead: input.command.read, updatedAt: new Date() })
        .where(baseCondition);
    } else if (input.command.kind === "move") {
      const mailboxState = resolveManagedMoveMailboxState(
        input.command.destination
      );
      await tx
        .update(managedMailMessage)
        .set({ mailboxState, updatedAt: new Date() })
        .where(
          and(
            baseCondition,
            input.command.destination === "archive"
              ? ne(managedMailMessage.mailboxState, "draft")
              : undefined
          )
        );
    } else if (input.command.kind === "set-labels") {
      const labelIds = [
        ...new Set([...input.command.addIds, ...input.command.removeIds]),
      ];
      if (labelIds.length > 0) {
        const labels = await tx
          .select({ id: managedMailLabel.id })
          .from(managedMailLabel)
          .where(
            and(
              eq(managedMailLabel.mailboxId, input.mailboxId),
              inArray(managedMailLabel.id, labelIds)
            )
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
              inArray(managedMailMessageLabel.labelId, input.command.removeIds)
            )
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
                : []
            )
          )
          .onConflictDoNothing({
            target: [
              managedMailMessageLabel.messageId,
              managedMailMessageLabel.labelId,
            ],
          });
      }
    } else {
      throw new ORPCError("BAD_REQUEST", {
        message: "This bulk action is not supported for managed mailboxes.",
      });
    }

    const [updatedMailbox] = await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
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
        eq(managedMailMessage.threadId, input.threadId)
      )
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
          eq(managedMailMessage.threadId, input.threadId)
        )
      );
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
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
        records.map((record) => record.id)
      )
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
        labelIdsByMessageId.get(record.id) ?? []
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
        eq(managedMailMessage.id, input.messageId)
      )
    )
    .limit(1);
  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Message not found." });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(managedMailMessage)
      .set({ mailboxState: input.state, updatedAt: new Date() })
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.id, input.messageId)
        )
      );
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
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
      customLabels.map((assignment) => assignment.labelId)
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
    input.state === "archived"
      ? ne(managedMailMessage.mailboxState, "draft")
      : undefined;
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
        stateCondition
      )
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
          stateCondition
        )
      );
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
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
        records.map((record) => record.id)
      )
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
        labelIdsByMessageId.get(record.id) ?? []
      ),
    })),
    threadId: input.threadId,
  };
};

export const getManagedMessageDelivery = async (input: {
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["reader", "responder", "manager"],
    userId: input.userId,
  });
  if (!selectedMailbox.organizationId) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Managed mailbox team is missing.",
    });
  }
  const [message] = await db
    .select({ providerMessageId: managedMailMessage.providerMessageId })
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.id, input.messageId),
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.direction, "outbound")
      )
    )
    .limit(1);
  if (message === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Sent message not found." });
  }
  return await getOrganizationMailDelivery({
    organizationId: selectedMailbox.organizationId,
    providerMessageId: message.providerMessageId,
  });
};

export const listManagedMessageDeliveryStatuses = async (input: {
  mailboxId: string;
  messageIds: string[];
  userId: string;
}) => {
  if (input.messageIds.length === 0) {
    return {};
  }
  const selectedMailbox = await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["reader", "responder", "manager"],
    userId: input.userId,
  });
  if (!selectedMailbox.organizationId) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Managed mailbox team is missing.",
    });
  }

  const rows = await db
    .select({
      messageId: managedMailMessage.id,
      status: organizationMailDeliveryRecipient.status,
    })
    .from(managedMailMessage)
    .innerJoin(
      organizationMailDeliveryRecipient,
      and(
        eq(
          organizationMailDeliveryRecipient.providerMessageId,
          managedMailMessage.providerMessageId
        ),
        eq(
          organizationMailDeliveryRecipient.organizationId,
          selectedMailbox.organizationId
        )
      )
    )
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        eq(managedMailMessage.direction, "outbound"),
        inArray(managedMailMessage.id, input.messageIds)
      )
    );

  return groupDeliveryStatusesByMessage(rows);
};
