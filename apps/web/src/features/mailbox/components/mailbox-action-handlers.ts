"use client";

import type { MailCommand } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";

import type { MailboxCategory, MessageListItem } from "#/lib/gmail/gmail";
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
} from "#/lib/gmail/inbox-query";
import type { ThreadListEntry } from "#/lib/gmail/thread-list";

type LabelChangeSet = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

type ThreadLabelUpdate = LabelChangeSet & { threadId: string };

const BULK_ACTION_CONCURRENCY = 3;

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

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
  itemId: string
) => Promise<void>;

export type MailboxPendingActions = {
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isThreadActionPending: (threadId: string | null | undefined) => boolean;
};

const getUniqueIds = (ids: readonly string[]) => [
  ...new Set(
    ids.flatMap((id) => {
      const normalizedId = id.trim();
      return normalizedId ? [normalizedId] : [];
    })
  ),
];

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
  const runMessageAction = async (
    messageId: string,
    action: () => Promise<void>
  ) => {
    if (isMessageActionPending(messageId)) {
      return;
    }

    setMessageActionPending(messageId, true);
    try {
      await action();
      await refreshSearchResultsIfNeeded();
    } finally {
      setMessageActionPending(messageId, false);
    }
  };

  const runThreadAction = async (
    threadId: string,
    action: () => Promise<void>
  ) => {
    if (isThreadActionPending(threadId)) {
      return;
    }

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
    if (actionableIds.length === 0) {
      return;
    }

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
              const id = actionableIds[nextIndex];
              nextIndex += 1;
              if (!id) {
                continue;
              }

              try {
                // The worker pool intentionally serializes each lane while
                // keeping the overall bulk action concurrency bounded.
                // oxlint-disable-next-line eslint/no-await-in-loop
                await action(id);
                shouldRefreshSearchResults = true;
              } catch (error) {
                actionError ??= error;
              }
            }
          }
        )
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
          throw refreshError instanceof Error
            ? refreshError
            : new Error("Refreshing search results failed.", {
                cause: refreshError,
              });
        }
      }
    }

    if (actionError !== undefined) {
      throw actionError instanceof Error
        ? actionError
        : new Error("Mailbox action failed.", { cause: actionError });
    }
  };

  const runBulkMessageAction = async (
    messageIds: readonly string[],
    action: (messageId: string) => Promise<void>
  ) => {
    await runBulkAction({
      action,
      ids: messageIds,
      isPending: isMessageActionPending,
      setPending: setMessageActionsPending,
    });
  };

  const runBulkThreadAction = async (
    threadIds: readonly string[],
    action: (threadId: string) => Promise<void>
  ) => {
    await runBulkAction({
      action,
      ids: threadIds,
      isPending: isThreadActionPending,
      setPending: setThreadActionsPending,
    });
  };

  const runMailboxMessageAction = async (
    messageId: string,
    action: MailboxItemAction
  ) => {
    await runMessageAction(messageId, async () => {
      await action(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId
      );
    });
  };

  const runMailboxThreadAction = async (
    threadId: string,
    action: MailboxItemAction
  ) => {
    await runThreadAction(threadId, async () => {
      await action(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId
      );
    });
  };

  const runBulkMailboxCommand = async (
    threads: ThreadListEntry[],
    command: MailCommand
  ) => {
    const actionableThreads = threads.filter(
      (thread) => !isThreadActionPending(thread.threadId)
    );
    if (actionableThreads.length === 0) {
      return;
    }
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
        command
      );
      await refreshSearchResultsIfNeeded();
    } finally {
      setThreadActionsPending(threadIds, false);
    }
  };

  const deleteDraft = async (message: MessageListItem) => {
    const { draftId } = message;
    if (!hasText(draftId)) {
      return;
    }

    await runMessageAction(message.id, async () => {
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        message.id,
        draftId
      );
    });
  };

  const deleteDrafts = async (threads: ThreadListEntry[]) => {
    const draftsByMessageId = new Map(
      threads.flatMap((thread) => {
        const message = thread.anchorMessage;
        return hasText(message.draftId)
          ? [[message.id, message.draftId] as const]
          : [];
      })
    );

    await runBulkMessageAction(
      [...draftsByMessageId.keys()],
      async (messageId) => {
        const draftId = draftsByMessageId.get(messageId);
        if (!hasText(draftId)) {
          return;
        }
        await deleteDraftInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          messageId,
          draftId
        );
      }
    );
  };

  return {
    archiveMessage: async (messageId: string) => {
      await runMailboxMessageAction(messageId, archiveMessageInMailbox);
    },
    archiveThread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, archiveThreadInMailbox);
    },
    archiveThreads: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "archive",
        kind: "move",
      });
    },
    deleteDraft,
    deleteDrafts,
    markMessageAsRead: async (messageId: string) => {
      await runMailboxMessageAction(messageId, markMessageAsReadInMailbox);
    },
    markMessageAsSpam: async (messageId: string) => {
      await runMailboxMessageAction(messageId, markMessageAsSpamInMailbox);
    },
    markMessageAsUnread: async (messageId: string) => {
      await runMailboxMessageAction(messageId, markMessageAsUnreadInMailbox);
    },
    markThreadAsRead: async (threadId: string) => {
      await runMailboxThreadAction(threadId, markThreadAsReadInMailbox);
    },
    markThreadAsSpam: async (threadId: string) => {
      await runMailboxThreadAction(threadId, markThreadAsSpamInMailbox);
    },
    markThreadAsUnread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, markThreadAsUnreadInMailbox);
    },
    markThreadsAsRead: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, { kind: "set-read", read: true });
    },
    markThreadsAsSpam: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "spam",
        kind: "move",
      });
    },
    markThreadsAsUnread: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, { kind: "set-read", read: false });
    },
    moveMessageToTrash: async (messageId: string) => {
      await runMailboxMessageAction(messageId, moveMessageToTrashInMailbox);
    },
    moveThreadToTrash: async (threadId: string) => {
      await runMailboxThreadAction(threadId, moveThreadToTrashInMailbox);
    },
    moveThreadsToTrash: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "trash",
        kind: "move",
      });
    },
    unmarkMessageAsSpam: async (messageId: string) => {
      await runMailboxMessageAction(messageId, unmarkMessageAsSpamInMailbox);
    },
    unmarkThreadAsSpam: async (threadId: string) => {
      await runMailboxThreadAction(threadId, unmarkThreadAsSpamInMailbox);
    },
    unmarkThreadsAsSpam: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "inbox",
        kind: "move",
      });
    },
    unsubscribeFromMessage: async (messageId: string) => {
      await runMessageAction(messageId, async () => {
        await unsubscribeFromMessageMutation(messageId);
      });
    },
    untrashMessage: async (messageId: string) => {
      await runMailboxMessageAction(messageId, untrashMessageInMailbox);
    },
    untrashThread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, untrashThreadInMailbox);
    },
    untrashThreads: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "inbox",
        kind: "move",
      });
    },
    updateMessageLabels: async (messageId: string, changes: LabelChangeSet) => {
      await runMessageAction(messageId, async () => {
        await updateMessageLabelsInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          messageId,
          changes
        );
      });
    },
    updateThreadLabels: async (threadId: string, changes: LabelChangeSet) => {
      await runThreadAction(threadId, async () => {
        await updateThreadLabelsInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
          changes
        );
      });
    },
    updateThreadsLabels: async (updates: readonly ThreadLabelUpdate[]) => {
      const changesByThreadId = new Map(
        updates.map(({ threadId, ...changes }) => [threadId, changes])
      );
      await runBulkThreadAction(
        updates.map((update) => update.threadId),
        async (threadId) => {
          const changes = changesByThreadId.get(threadId);
          if (!changes) {
            await Promise.resolve();
            return;
          }
          await updateThreadLabelsInMailbox(
            queryClient,
            mailboxId,
            activeMailbox,
            activeSearchQuery,
            threadId,
            changes
          );
        }
      );
    },
  };
};

export type MailboxActions = ReturnType<typeof createMailboxActionHandlers>;
