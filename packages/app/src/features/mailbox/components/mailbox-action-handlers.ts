"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import {
  applyBulkChangesInMailbox,
  updateMessageInMailbox,
  updateThreadInMailbox,
  deleteDraftInMailbox,
} from "@quieter/app/lib/mail/inbox-query/index";
import type { MailMetadataOperation } from "@quieter/app/lib/mail/inbox-query/index";
import { findMessageInCachedMailboxQueries } from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getMailboxThreadQueriesKey } from "@quieter/app/lib/mail/thread-query-keys";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import type { MailCommand } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";

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
  unsubscribeFromMessageMutation: (messageId: string) => Promise<boolean>;
  mailboxId: string;
};

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
  unsubscribeFromMessageMutation,
  mailboxId,
}: MailboxActionHandlerArgs) => {
  const runAction = async (
    scope: "message" | "thread",
    id: string,
    action: () => Promise<void>
  ) => {
    const isPending =
      scope === "message" ? isMessageActionPending : isThreadActionPending;
    if (isPending(id)) {
      return;
    }
    const setPending =
      scope === "message" ? setMessageActionPending : setThreadActionPending;

    setPending(id, true);
    try {
      await action();
      await refreshSearchResultsIfNeeded();
    } finally {
      setPending(id, false);
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

  const runMailboxMessageAction = async (
    messageId: string,
    operation: MailMetadataOperation
  ) => {
    await updateMessageInMailbox(
      {
        mailbox: activeMailbox,
        mailboxId,
        messageId,
        queryClient,
        searchQuery: activeSearchQuery,
      },
      operation
    );
    await refreshSearchResultsIfNeeded();
  };
  const runMailboxThreadAction = async (
    threadId: string,
    operation: MailMetadataOperation
  ) => {
    await updateThreadInMailbox(
      { mailboxId, queryClient, threadId },
      operation
    );
    await refreshSearchResultsIfNeeded();
  };
  const runBulkMailboxCommand = async (
    threads: ThreadListEntry[],
    command: MailCommand
  ) => {
    const result = await applyBulkChangesInMailbox(
      queryClient,
      mailboxId,
      threads.map((thread) => ({
        messageIds:
          command.kind === "set-importance"
            ? []
            : thread.messages.map((message) => message.id),
        threadId: thread.threadId,
      })),
      command
    );
    await refreshSearchResultsIfNeeded();
    const failed = result.targets.find((target) => target.status === "failed");
    if (failed) {
      throw new Error("Could not update some messages.");
    }
  };

  const setImportance = async (
    id: string,
    scope: "message" | "thread",
    important: boolean
  ) => {
    let threadId = id;
    if (scope === "message") {
      const message =
        findMessageInCachedMailboxQueries(queryClient, mailboxId, id) ??
        queryClient
          .getQueriesData<ThreadMessagesResult>({
            queryKey: getMailboxThreadQueriesKey(mailboxId),
          })
          .flatMap(([, data]) => data?.messages ?? [])
          .find((candidate) => candidate.id === id);
      if (!message) {
        throw new Error("This message is no longer available.");
      }
      ({ threadId } = message);
    }
    await runAction(scope, id, async () => {
      const result = await applyBulkChangesInMailbox(
        queryClient,
        mailboxId,
        [{ messageIds: scope === "thread" ? [] : [id], threadId }],
        { important, kind: "set-importance" }
      );
      const failed = result.targets.find(
        (target) => target.status === "failed"
      );
      if (failed) {
        throw new Error("Could not update this conversation.");
      }
    });
  };

  const deleteDraft = async (message: MessageListItem) => {
    const { draftId } = message;
    if (!draftId) {
      return;
    }

    await runAction("message", message.id, async () => {
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        message.id,
        draftId,
        message.baseRevision
      );
    });
  };

  const deleteDrafts = async (threads: ThreadListEntry[]) => {
    const draftsByMessageId = new Map(
      threads.flatMap((thread) => {
        const message = thread.anchorMessage;
        return message.draftId ? [[message.id, message] as const] : [];
      })
    );

    await runBulkAction({
      action: async (messageId) => {
        const message = draftsByMessageId.get(messageId);
        if (!message?.draftId) {
          return;
        }
        await deleteDraftInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          messageId,
          message.draftId,
          message.baseRevision
        );
      },
      ids: [...draftsByMessageId.keys()],
      isPending: isMessageActionPending,
      setPending: setMessageActionsPending,
    });
  };

  return {
    archiveMessage: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "archive");
    },
    archiveThread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "archive");
    },
    archiveThreads: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "archive",
        kind: "move",
      });
    },
    get canSetImportance() {
      return (
        queryClient
          .getQueryData(mailboxesQueryOptions().queryKey)
          ?.groups.flatMap((group) => group.mailboxes)
          .find((mailbox) => mailbox.id === mailboxId)?.capabilities
          .canSetImportance === true
      );
    },
    deleteDraft,
    deleteDrafts,
    markMessageAsRead: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "read");
    },
    markMessageAsSpam: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "spam");
    },
    markMessageAsUnread: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "unread");
    },
    markThreadAsRead: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "read");
    },
    markThreadAsSpam: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "spam");
    },
    markThreadAsUnread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "unread");
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
      await runMailboxMessageAction(messageId, "trash");
    },
    moveThreadToTrash: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "trash");
    },
    moveThreadsToTrash: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "trash",
        kind: "move",
      });
    },
    setMessageImportance: async (id: string, important: boolean) => {
      await setImportance(id, "message", important);
    },
    setThreadImportance: async (id: string, important: boolean) => {
      await setImportance(id, "thread", important);
    },
    setThreadsImportance: async (
      threads: ThreadListEntry[],
      important: boolean
    ) => {
      await runBulkMailboxCommand(threads, {
        important,
        kind: "set-importance",
      });
    },
    unmarkMessageAsSpam: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "unspam");
    },
    unmarkThreadAsSpam: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "unspam");
    },
    unmarkThreadsAsSpam: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "inbox",
        kind: "move",
      });
    },
    unsubscribeFromMessage: async (messageId: string) => {
      if (isMessageActionPending(messageId)) {
        return false;
      }
      setMessageActionPending(messageId, true);
      try {
        return await unsubscribeFromMessageMutation(messageId);
      } catch (error) {
        toastError(error, { boundary: "unsubscribe" });
        return false;
      } finally {
        setMessageActionPending(messageId, false);
      }
    },
    untrashMessage: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "untrash");
    },
    untrashThread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "untrash");
    },
    untrashThreads: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "inbox",
        kind: "move",
      });
    },
    updateMessageLabels: async (messageId: string, changes: LabelChangeSet) => {
      await runMailboxMessageAction(messageId, changes);
    },
    updateThreadLabels: async (threadId: string, changes: LabelChangeSet) => {
      await runMailboxThreadAction(threadId, changes);
    },
    updateThreadsLabels: async (updates: readonly ThreadLabelUpdate[]) => {
      await Promise.all(
        updates.map(async ({ threadId, ...changes }) => {
          await runMailboxThreadAction(threadId, changes);
        })
      );
    },
  };
};

export type MailboxActions = ReturnType<typeof createMailboxActionHandlers>;
