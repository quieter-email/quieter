import {
  mailSyncEntity,
  mailSyncStream,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database/schema";
import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import type { MessageListItem } from "@quieter/mail/messages";
import type { SyncMessage } from "@quieter/sync";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { encodeSyncBody, prepareSyncMessage } from "../body-store";
import type { SyncBodyStore } from "../body-store";
import type { SyncRepository, SyncTransaction } from "../repository";

type ManagedMessage = typeof managedMailMessage.$inferSelect;
export type ManagedSyncSelection = {
  threadIds?: readonly string[];
  messageIds?: readonly string[];
  labels?: boolean;
};

export const managedSyncMessage = (
  record: ManagedMessage,
  attachments: MessageListItem["attachments"],
  customLabels: string[]
): SyncMessage => {
  let category: string;
  switch (record.mailboxState) {
    case "draft": {
      category = "DRAFT";
      break;
    }
    case "trash": {
      category = "TRASH";
      break;
    }
    case "spam": {
      category = "SPAM";
      break;
    }
    case "archived": {
      category = "ARCHIVE";
      break;
    }
    case "active": {
      category = record.direction === "inbound" ? "INBOX" : "SENT";
      break;
    }
    default: {
      throw new Error("Unknown managed mailbox state.");
    }
  }
  const body = encodeSyncBody({
    bodyHtml: record.bodyHtml ?? undefined,
    bodyText: record.bodyText ?? undefined,
  });
  return {
    attachments: attachments ?? [],
    bcc: record.bcc ?? undefined,
    body: { bytes: body.bytes, hash: body.hash },
    cc: record.cc ?? undefined,
    date: record.sentAt.toISOString(),
    draftAnchor: parseDraftAnchorFromHeaderReader(
      (name) =>
        record.headers.find(
          (header) => header.name.toLowerCase() === name.toLowerCase()
        )?.value
    ),
    draftId:
      record.mailboxState === "draft" ? record.providerMessageId : undefined,
    from: record.from,
    id: record.id,
    inReplyTo: record.inReplyTo ?? undefined,
    internalDate: String(record.sentAt.getTime()),
    isUnread: !record.isRead,
    labelIds: [
      category,
      ...(record.isRead ? [] : ["UNREAD"]),
      ...customLabels.toSorted(),
    ],
    messageHeaderId: record.messageHeaderId ?? undefined,
    references: record.references ?? undefined,
    replyTo: record.replyTo ?? undefined,
    snippet: record.snippet ?? undefined,
    subject: record.subject ?? undefined,
    threadId: record.threadId,
    to: record.to ?? undefined,
  };
};

export const projectManagedMailbox = async (
  context: SyncTransaction,
  selection: ManagedSyncSelection
) => {
  const { database, mailboxId, put } = context;
  const selectedMessages =
    selection.messageIds !== undefined && selection.messageIds.length > 0
      ? await database
          .select({ threadId: managedMailMessage.threadId })
          .from(managedMailMessage)
          .where(
            and(
              eq(managedMailMessage.mailboxId, mailboxId),
              inArray(managedMailMessage.id, [...selection.messageIds])
            )
          )
      : [];
  const oldSelectedMessages =
    selection.messageIds !== undefined && selection.messageIds.length > 0
      ? await database
          .select({ threadId: mailSyncEntity.threadId })
          .from(mailSyncEntity)
          .where(
            and(
              eq(mailSyncEntity.mailboxId, mailboxId),
              eq(mailSyncEntity.kind, "message"),
              inArray(mailSyncEntity.entityId, [...selection.messageIds])
            )
          )
      : [];
  const threadIds = [
    ...new Set([
      ...(selection.threadIds ?? []),
      ...selectedMessages.map((message) => message.threadId),
      ...oldSelectedMessages.flatMap((message) =>
        message.threadId === null ? [] : [message.threadId]
      ),
    ]),
  ];
  if (threadIds.length > 0) {
    const messages = await database
      .select()
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, mailboxId),
          inArray(managedMailMessage.threadId, threadIds)
        )
      )
      .orderBy(asc(managedMailMessage.sentAt), asc(managedMailMessage.id));
    const messageIds = messages.map((message) => message.id);
    const attachments =
      messageIds.length === 0
        ? []
        : await database
            .select()
            .from(managedMailAttachment)
            .where(
              and(
                eq(managedMailAttachment.mailboxId, mailboxId),
                inArray(managedMailAttachment.messageId, messageIds)
              )
            );
    const assignments =
      messageIds.length === 0
        ? []
        : await database
            .select()
            .from(managedMailMessageLabel)
            .where(
              and(
                eq(managedMailMessageLabel.mailboxId, mailboxId),
                inArray(managedMailMessageLabel.messageId, messageIds)
              )
            );
    const byThread = new Map<string, SyncMessage[]>();
    for (const message of messages) {
      const value = managedSyncMessage(
        message,
        attachments
          .filter((attachment) => attachment.messageId === message.id)
          .map((attachment) => ({
            attachmentId: attachment.id,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })),
        assignments
          .filter((assignment) => assignment.messageId === message.id)
          .map((assignment) => assignment.labelId)
      );
      put({
        data: { kind: "message", value },
        id: message.id,
        kind: "message",
        sortAt: message.sentAt,
        threadId: message.threadId,
      });
      const thread = byThread.get(message.threadId) ?? [];
      thread.push(value);
      byThread.set(message.threadId, thread);
    }
    const oldMessages = await database
      .select({
        id: mailSyncEntity.entityId,
        threadId: mailSyncEntity.threadId,
      })
      .from(mailSyncEntity)
      .where(
        and(
          eq(mailSyncEntity.mailboxId, mailboxId),
          eq(mailSyncEntity.kind, "message"),
          inArray(mailSyncEntity.threadId, threadIds)
        )
      );
    const currentIds = new Set(messageIds);
    for (const old of oldMessages) {
      if (!currentIds.has(old.id)) {
        put({
          data: null,
          id: old.id,
          kind: "message",
          threadId: old.threadId ?? undefined,
        });
      }
    }
    for (const threadId of threadIds) {
      const thread = byThread.get(threadId) ?? [];
      const latest = thread.at(-1);
      put({
        data:
          latest === undefined
            ? null
            : {
                kind: "thread",
                value: {
                  attachmentCount: thread.reduce(
                    (count, message) => count + message.attachments.length,
                    0
                  ),
                  id: threadId,
                  isUnread: thread.some((message) => message.isUnread),
                  labelIds: [
                    ...new Set(thread.flatMap((message) => message.labelIds)),
                  ].toSorted(),
                  latest,
                  messageCount: thread.length,
                  messageIds: thread.map((message) => message.id),
                },
              },
        id: threadId,
        kind: "thread",
        sortAt:
          latest === undefined
            ? undefined
            : new Date(Number(latest.internalDate)),
        threadId,
      });
    }
  }
  if (selection.labels === true) {
    const labels = await database
      .select()
      .from(managedMailLabel)
      .where(eq(managedMailLabel.mailboxId, mailboxId));
    const oldLabels = await database
      .select({ id: mailSyncEntity.entityId })
      .from(mailSyncEntity)
      .where(
        and(
          eq(mailSyncEntity.mailboxId, mailboxId),
          eq(mailSyncEntity.kind, "label")
        )
      );
    const current = new Set(labels.map((label) => label.id));
    for (const label of labels) {
      put({
        data: {
          kind: "label",
          value: {
            color: label.color,
            description: label.description,
            id: label.id,
            name: label.name,
            type: "user",
          },
        },
        id: label.id,
        kind: "label",
      });
    }
    for (const old of oldLabels) {
      if (!current.has(old.id)) {
        put({ data: null, id: old.id, kind: "label" });
      }
    }
  }
  const grouped = await database
    .select({
      count: sql<number>`count(distinct ${managedMailMessage.threadId})::int`,
      direction: managedMailMessage.direction,
      state: managedMailMessage.mailboxState,
      unread: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where not ${managedMailMessage.isRead})::int`,
    })
    .from(managedMailMessage)
    .where(eq(managedMailMessage.mailboxId, mailboxId))
    .groupBy(managedMailMessage.direction, managedMailMessage.mailboxState);
  const counts: Record<string, number> = {
    archive: 0,
    drafts: 0,
    inbox: 0,
    sent: 0,
    spam: 0,
    trash: 0,
    unread: 0,
  };
  for (const group of grouped) {
    let category: string = group.state;
    if (group.state === "active") {
      category = group.direction === "inbound" ? "inbox" : "sent";
    } else if (group.state === "archived") {
      category = "archive";
    } else if (group.state === "draft") {
      category = "drafts";
    }
    counts[category] += group.count;
    if (category === "inbox") {
      counts.unread += group.unread;
    }
  }
  put({
    data: { kind: "overview", value: { counts, status: "ready" } },
    id: mailboxId,
    kind: "overview",
  });
};

export const bootstrapManagedMailbox = async (
  repository: SyncRepository,
  store: SyncBodyStore,
  mailboxId: string
) => {
  const messages = await repository.database
    .select()
    .from(managedMailMessage)
    .where(eq(managedMailMessage.mailboxId, mailboxId))
    .orderBy(desc(managedMailMessage.sentAt))
    .limit(200);
  for (const message of messages) {
    await prepareSyncMessage(store, mailboxId, {
      ...managedSyncMessage(message, [], []),
      bodyHtml: message.bodyHtml ?? undefined,
      bodyText: message.bodyText ?? undefined,
    });
  }
  await repository.transaction(mailboxId, async (context) => {
    await projectManagedMailbox(context, {
      labels: true,
      threadIds: messages.map((message) => message.threadId),
    });
    await context.database
      .update(mailSyncStream)
      .set({ initialized: true })
      .where(eq(mailSyncStream.mailboxId, mailboxId));
  });
};
