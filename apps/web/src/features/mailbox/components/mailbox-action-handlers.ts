"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import {
  deleteDraftInMailbox,
  deleteMessagePermanentlyInMailbox,
  deleteThreadPermanentlyInMailbox,
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
      const results = await Promise.allSettled(actionableIds.map((id) => action(id)));
      for (const result of results) {
        if (result.status === "fulfilled") {
          shouldRefreshSearchResults = true;
        } else {
          actionError ??= result.reason;
        }
      }
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

  const runBulkMailboxThreadAction = (threads: ThreadListEntry[], action: MailboxItemAction) =>
    runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      (threadId) => action(queryClient, mailboxId, activeMailbox, activeSearchQuery, threadId),
    );

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
    deleteDraft,
    deleteDrafts,
    deleteMessagePermanently: (messageId: string) =>
      runMailboxMessageAction(messageId, deleteMessagePermanentlyInMailbox),
    deleteThreadPermanently: (threadId: string) =>
      runMailboxThreadAction(threadId, deleteThreadPermanentlyInMailbox),
    deleteThreadsPermanently: (threads: ThreadListEntry[]) =>
      runBulkMailboxThreadAction(threads, deleteThreadPermanentlyInMailbox),
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
      runBulkMailboxThreadAction(threads, markThreadAsReadInMailbox),
    markThreadsAsSpam: (threads: ThreadListEntry[]) =>
      runBulkMailboxThreadAction(threads, markThreadAsSpamInMailbox),
    markThreadsAsUnread: (threads: ThreadListEntry[]) =>
      runBulkMailboxThreadAction(threads, markThreadAsUnreadInMailbox),
    markThreadAsUnread: (threadId: string) =>
      runMailboxThreadAction(threadId, markThreadAsUnreadInMailbox),
    moveMessageToTrash: (messageId: string) =>
      runMailboxMessageAction(messageId, moveMessageToTrashInMailbox),
    moveThreadToTrash: (threadId: string) =>
      runMailboxThreadAction(threadId, moveThreadToTrashInMailbox),
    moveThreadsToTrash: (threads: ThreadListEntry[]) =>
      runBulkMailboxThreadAction(threads, moveThreadToTrashInMailbox),
    unmarkMessageAsSpam: (messageId: string) =>
      runMailboxMessageAction(messageId, unmarkMessageAsSpamInMailbox),
    unmarkThreadAsSpam: (threadId: string) =>
      runMailboxThreadAction(threadId, unmarkThreadAsSpamInMailbox),
    unmarkThreadsAsSpam: (threads: ThreadListEntry[]) =>
      runBulkMailboxThreadAction(threads, unmarkThreadAsSpamInMailbox),
    unsubscribeFromMessage: (messageId: string) =>
      runMessageAction(messageId, () => unsubscribeFromMessageMutation(messageId)),
    untrashMessage: (messageId: string) =>
      runMailboxMessageAction(messageId, untrashMessageInMailbox),
    untrashThread: (threadId: string) => runMailboxThreadAction(threadId, untrashThreadInMailbox),
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
  };
};

export type MailboxActions = ReturnType<typeof createMailboxActionHandlers>;
