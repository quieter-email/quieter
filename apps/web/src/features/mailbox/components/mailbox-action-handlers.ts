"use client";

import type { MailCommand } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";
import type { MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import {
  applyBulkChangesInMailbox,
  archiveMessageInMailbox,
  archiveThreadInMailbox,
  deleteDraftInMailbox,
  markMessageAsReadInMailbox,
  markMessageAsSpamInMailbox,
  markMessageAsUnreadInMailbox,
  markThreadAsReadInMailbox,
  markThreadAsSpamInMailbox,
  markThreadAsUnreadInMailbox,
  moveMessageToTrashInMailbox,
  moveThreadToTrashInMailbox,
  unmarkMessageAsSpamInMailbox,
  unmarkThreadAsSpamInMailbox,
  untrashMessageInMailbox,
  untrashThreadInMailbox,
  updateMessageLabelsInMailbox,
  updateThreadLabelsInMailbox,
} from "~/lib/gmail/inbox-query";

type LabelChangeSet = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

type ThreadLabelUpdate = LabelChangeSet & { threadId: string };

const BULK_ACTION_CONCURRENCY = 3;

type MailboxActionHandlerArgs = {
  activeMailbox: MailboxCategory;
  activeSearchQuery: string;
  queryClient: QueryClient;
  refreshSearchResultsIfNeeded: () => Promise<void>;
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isThreadActionPending: (threadId: string | null | undefined) => boolean;
  setMessageActionPending: (messageId: string, pending: boolean) => void;
  setMessageActionsPending: (messageIds: string[], pending: boolean) => void;
  setThreadActionPending: (threadId: string, pending: boolean) => void;
  setThreadActionsPending: (threadIds: string[], pending: boolean) => void;
  unsubscribeFromMessageMutation: (messageId: string) => Promise<void>;
  mailboxId: string;
};

type MailboxItemAction = (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string,
  itemId: string,
) => Promise<void>;

export type MailboxPendingActions = {
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isThreadActionPending: (threadId: string | null | undefined) => boolean;
};

export const createMailboxActionHandlers = ({
  activeMailbox,
  activeSearchQuery,
  queryClient,
  refreshSearchResultsIfNeeded,
  isMessageActionPending,
  isThreadActionPending,
  setMessageActionPending,
  setMessageActionsPending,
  setThreadActionPending,
  setThreadActionsPending,
  unsubscribeFromMessageMutation,
  mailboxId,
}: MailboxActionHandlerArgs) => {
  const getUniqueIds = (ids: readonly string[]) =>
    Array.from(
      new Set(
        ids.flatMap((id) => {
          const normalizedId = id.trim();
          return normalizedId ? [normalizedId] : [];
        }),
      ),
    );

  const runMessageAction = async (messageId: string, action: () => Promise<void>) => {
    if (isMessageActionPending(messageId)) return;

    setMessageActionPending(messageId, true);
    try {
      await action();
      await refreshSearchResultsIfNeeded();
    } finally {
      setMessageActionPending(messageId, false);
    }
  };

  const runThreadAction = async (threadId: string, action: () => Promise<void>) => {
    if (isThreadActionPending(threadId)) return;

    setThreadActionPending(threadId, true);
    try {
      await action();
      await refreshSearchResultsIfNeeded();
    } finally {
      setThreadActionPending(threadId, false);
    }
  };

  const runBulkAction = async ({
    action,
    ids,
    isPending,
    setPending,
  }: {
    action: (id: string) => Promise<void>;
    ids: readonly string[];
    isPending: (id: string) => boolean;
    setPending: (ids: string[], pending: boolean) => void;
  }) => {
    const actionableIds = getUniqueIds(ids).filter((id) => !isPending(id));
    if (actionableIds.length === 0) return;

    setPending(actionableIds, true);
    let actionError: unknown;
    let shouldRefreshSearchResults = false;

    try {
      let nextIndex = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(BULK_ACTION_CONCURRENCY, actionableIds.length) },
          async () => {
            while (nextIndex < actionableIds.length) {
              const id = actionableIds[nextIndex++];
              if (!id) continue;

              try {
                await action(id);
                shouldRefreshSearchResults = true;
              } catch (error) {
                actionError ??= error;
              }
            }
          },
        ),
      );
    } catch (error) {
      actionError = error;
    } finally {
      setPending(actionableIds, false);
    }

    if (shouldRefreshSearchResults) {
      try {
        await refreshSearchResultsIfNeeded();
      } catch (refreshError) {
        if (actionError === undefined) {
          throw refreshError;
        }
      }
    }

    if (actionError) {
      throw actionError;
    }
  };

  const runBulkMessageAction = async (
    messageIds: readonly string[],
    action: (messageId: string) => Promise<void>,
  ) =>
    runBulkAction({
      action,
      ids: messageIds,
      isPending: isMessageActionPending,
      setPending: setMessageActionsPending,
    });

  const runBulkThreadAction = async (
    threadIds: readonly string[],
    action: (threadId: string) => Promise<void>,
  ) =>
    runBulkAction({
      action,
      ids: threadIds,
      isPending: isThreadActionPending,
      setPending: setThreadActionsPending,
    });

  const runMailboxMessageAction = (messageId: string, action: MailboxItemAction) =>
    runMessageAction(messageId, () =>
      action(queryClient, mailboxId, activeMailbox, activeSearchQuery, messageId),
    );

  const runMailboxThreadAction = (threadId: string, action: MailboxItemAction) =>
    runThreadAction(threadId, () =>
      action(queryClient, mailboxId, activeMailbox, activeSearchQuery, threadId),
    );

  const runBulkMailboxCommand = async (threads: ThreadListEntry[], command: MailCommand) => {
    const actionableThreads = threads.filter((thread) => !isThreadActionPending(thread.threadId));
    if (actionableThreads.length === 0) return;
    const threadIds = actionableThreads.map((thread) => thread.threadId);
    setThreadActionsPending(threadIds, true);
    try {
      await applyBulkChangesInMailbox(
        queryClient,
        mailboxId,
        actionableThreads.map((thread) => ({
          messageIds: thread.messages.map((message) => message.id),
          threadId: thread.threadId,
        })),
        command,
      );
      await refreshSearchResultsIfNeeded();
    } finally {
      setThreadActionsPending(threadIds, false);
    }
  };

  const deleteDraft = async (message: MessageListItem) => {
    const draftId = message.draftId;
    if (!draftId) return;

    await runMessageAction(message.id, async () => {
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        message.id,
        draftId,
      );
    });
  };

  const deleteDrafts = async (threads: ThreadListEntry[]) => {
    const draftsByMessageId = new Map(
      threads.flatMap((thread) => {
        const message = thread.anchorMessage;
        return message.draftId ? [[message.id, message.draftId] as const] : [];
      }),
    );

    await runBulkMessageAction(Array.from(draftsByMessageId.keys()), async (messageId) => {
      const draftId = draftsByMessageId.get(messageId);
      if (!draftId) return;
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
        draftId,
      );
    });
  };

  return {
    archiveMessage: (messageId: string) =>
      runMailboxMessageAction(messageId, archiveMessageInMailbox),
    archiveThread: (threadId: string) => runMailboxThreadAction(threadId, archiveThreadInMailbox),
    archiveThreads: (threads: ThreadListEntry[]) =>
      runBulkMailboxCommand(threads, { kind: "move", destination: "archive" }),
    deleteDraft,
    deleteDrafts,
    markMessageAsRead: (messageId: string) =>
      runMailboxMessageAction(messageId, markMessageAsReadInMailbox),
    markMessageAsSpam: (messageId: string) =>
      runMailboxMessageAction(messageId, markMessageAsSpamInMailbox),
    markMessageAsUnread: (messageId: string) =>
      runMailboxMessageAction(messageId, markMessageAsUnreadInMailbox),
    markThreadAsRead: (threadId: string) =>
      runMailboxThreadAction(threadId, markThreadAsReadInMailbox),
    markThreadAsSpam: (threadId: string) =>
      runMailboxThreadAction(threadId, markThreadAsSpamInMailbox),
    markThreadsAsRead: (threads: ThreadListEntry[]) =>
      runBulkMailboxCommand(threads, { kind: "set-read", read: true }),
    markThreadsAsSpam: (threads: ThreadListEntry[]) =>
      runBulkMailboxCommand(threads, { kind: "move", destination: "spam" }),
    markThreadsAsUnread: (threads: ThreadListEntry[]) =>
      runBulkMailboxCommand(threads, { kind: "set-read", read: false }),
    markThreadAsUnread: (threadId: string) =>
      runMailboxThreadAction(threadId, markThreadAsUnreadInMailbox),
    moveMessageToTrash: (messageId: string) =>
      runMailboxMessageAction(messageId, moveMessageToTrashInMailbox),
    moveThreadToTrash: (threadId: string) =>
      runMailboxThreadAction(threadId, moveThreadToTrashInMailbox),
    moveThreadsToTrash: (threads: ThreadListEntry[]) =>
      runBulkMailboxCommand(threads, { kind: "move", destination: "trash" }),
    unmarkMessageAsSpam: (messageId: string) =>
      runMailboxMessageAction(messageId, unmarkMessageAsSpamInMailbox),
    unmarkThreadAsSpam: (threadId: string) =>
      runMailboxThreadAction(threadId, unmarkThreadAsSpamInMailbox),
    unmarkThreadsAsSpam: (threads: ThreadListEntry[]) =>
      runBulkMailboxCommand(threads, { kind: "move", destination: "inbox" }),
    unsubscribeFromMessage: (messageId: string) =>
      runMessageAction(messageId, () => unsubscribeFromMessageMutation(messageId)),
    untrashMessage: (messageId: string) =>
      runMailboxMessageAction(messageId, untrashMessageInMailbox),
    untrashThread: (threadId: string) => runMailboxThreadAction(threadId, untrashThreadInMailbox),
    untrashThreads: (threads: ThreadListEntry[]) =>
      runBulkMailboxCommand(threads, { kind: "move", destination: "inbox" }),
    updateMessageLabels: (messageId: string, changes: LabelChangeSet) =>
      runMessageAction(messageId, () =>
        updateMessageLabelsInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          messageId,
          changes,
        ),
      ),
    updateThreadLabels: (threadId: string, changes: LabelChangeSet) =>
      runThreadAction(threadId, () =>
        updateThreadLabelsInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
          changes,
        ),
      ),
    updateThreadsLabels: (updates: readonly ThreadLabelUpdate[]) => {
      const changesByThreadId = new Map(
        updates.map(({ threadId, ...changes }) => [threadId, changes]),
      );
      return runBulkThreadAction(
        updates.map((update) => update.threadId),
        (threadId) => {
          const changes = changesByThreadId.get(threadId);
          if (!changes) return Promise.resolve();
          return updateThreadLabelsInMailbox(
            queryClient,
            mailboxId,
            activeMailbox,
            activeSearchQuery,
            threadId,
            changes,
          );
        },
      );
    },
  };
};

export type MailboxActions = ReturnType<typeof createMailboxActionHandlers>;
