import {
  mailSyncEntity,
  mailSyncProviderState,
  mailSyncStream,
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database/schema";
import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import type { MessageListItem } from "@quieter/mail/messages";
import type { SyncMessage } from "@quieter/sync";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { encodeSyncBody, prepareSyncMessage } from "../body-store";
import type { SyncBodyStore } from "../body-store";
import { projectManagedDelivery } from "../delivery";
import { projectSavedViews } from "../metadata";
import type { SyncRepository, SyncTransaction } from "../repository";
import { assertProviderLease, withProviderLease } from "./lease";

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
    draftVersion:
      record.mailboxState === "draft" ? record.sentAt.toISOString() : undefined,
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
    await projectManagedDelivery(context, messageIds);
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
          kind: "delivery",
          threadId: old.threadId ?? undefined,
        });
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
            position: label.position,
            type: "user",
            visible: label.visible,
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
    await projectSavedViews(context);
  }
  const [counts] = await database
    .select({
      archive: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where ${managedMailMessage.mailboxState} = 'archived')::int`,
      drafts: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where ${managedMailMessage.mailboxState} = 'draft')::int`,
      inbox: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where ${managedMailMessage.mailboxState} = 'active' and ${managedMailMessage.direction} = 'inbound')::int`,
      sent: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where ${managedMailMessage.mailboxState} = 'active' and ${managedMailMessage.direction} = 'outbound')::int`,
      spam: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where ${managedMailMessage.mailboxState} = 'spam')::int`,
      trash: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where ${managedMailMessage.mailboxState} = 'trash')::int`,
      unread: sql<number>`count(distinct ${managedMailMessage.threadId}) filter (where not ${managedMailMessage.isRead} and ${managedMailMessage.mailboxState} not in ('spam', 'trash', 'draft'))::int`,
      unreadNonSpamCount: sql<number>`count(*) filter (where not ${managedMailMessage.isRead} and ${managedMailMessage.mailboxState} = 'active' and ${managedMailMessage.direction} = 'inbound')::int`,
    })
    .from(managedMailMessage)
    .where(eq(managedMailMessage.mailboxId, mailboxId));
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
) =>
  await withProviderLease(repository, mailboxId, async (state, leaseId) => {
    if (state.phase === "ready") {
      return { hasMore: false };
    }
    const cursor =
      state.pageToken === null
        ? null
        : z
            .object({ sentAt: z.string(), threadId: z.string() })
            .parse(JSON.parse(state.pageToken));
    const threads = await repository.database
      .select({
        sentAt: sql<string>`max(${managedMailMessage.sentAt})::text`,
        threadId: managedMailMessage.threadId,
      })
      .from(managedMailMessage)
      .where(eq(managedMailMessage.mailboxId, mailboxId))
      .groupBy(managedMailMessage.threadId)
      .having(
        cursor === null
          ? undefined
          : or(
              sql`max(${managedMailMessage.sentAt}) < ${cursor.sentAt}::timestamp`,
              and(
                sql`max(${managedMailMessage.sentAt}) = ${cursor.sentAt}::timestamp`,
                lt(managedMailMessage.threadId, cursor.threadId)
              )
            )
      )
      .orderBy(
        desc(sql`max(${managedMailMessage.sentAt})`),
        desc(managedMailMessage.threadId)
      )
      .limit(25);
    const threadIds = threads.map((thread) => thread.threadId);
    const messages =
      threadIds.length === 0
        ? []
        : await repository.database
            .select()
            .from(managedMailMessage)
            .where(
              and(
                eq(managedMailMessage.mailboxId, mailboxId),
                inArray(managedMailMessage.threadId, threadIds)
              )
            );
    for (let offset = 0; offset < messages.length; offset += 4) {
      await Promise.all(
        messages.slice(offset, offset + 4).map(async (message) => {
          await prepareSyncMessage(store, mailboxId, {
            ...managedSyncMessage(message, [], []),
            bodyHtml: message.bodyHtml ?? undefined,
            bodyText: message.bodyText ?? undefined,
          });
        })
      );
    }
    const hasMore = threads.length === 25;
    await repository.transaction(mailboxId, async (context) => {
      await assertProviderLease(context, leaseId);
      await projectManagedMailbox(context, { labels: true, threadIds });
      await context.database
        .update(mailSyncProviderState)
        .set({
          lastSyncedAt: new Date(),
          pageToken: hasMore ? JSON.stringify(threads.at(-1)) : null,
          phase: hasMore ? "bootstrap" : "ready",
          updatedAt: new Date(),
        })
        .where(eq(mailSyncProviderState.mailboxId, mailboxId));
      await context.database
        .update(mailSyncStream)
        .set({ initialized: true })
        .where(eq(mailSyncStream.mailboxId, mailboxId));
    });
    return { hasMore };
  });
