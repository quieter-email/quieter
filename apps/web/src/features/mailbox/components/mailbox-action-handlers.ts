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

  const runBulkMessageAction = async (
    messageIds: readonly string[],
    action: (messageId: string) => Promise<void>,
  ) => {
    const actionableMessageIds = getUniqueIds(messageIds).filter(
      (messageId) => !isMessageActionPending(messageId),
    );
    if (actionableMessageIds.length === 0) return;

    setMessageActionsPending(actionableMessageIds, true);

    let actionError: unknown = null;
    let shouldRefreshSearchResults = false;

    try {
      for (const messageId of actionableMessageIds) {
        await action(messageId);
        shouldRefreshSearchResults = true;
      }
    } catch (error) {
      actionError = error;
    } finally {
      setMessageActionsPending(actionableMessageIds, false);
    }

    if (shouldRefreshSearchResults) {
      try {
        await refreshSearchResultsIfNeeded();
      } catch (refreshError) {
        if (!actionError) {
          throw refreshError;
        }
      }
    }

    if (actionError) {
      throw actionError;
    }
  };

  const runBulkThreadAction = async (
    threadIds: readonly string[],
    action: (threadId: string) => Promise<void>,
  ) => {
    const actionableThreadIds = getUniqueIds(threadIds).filter(
      (threadId) => !isThreadActionPending(threadId),
    );
    if (actionableThreadIds.length === 0) return;

    setThreadActionsPending(actionableThreadIds, true);

    let actionError: unknown = null;
    let shouldRefreshSearchResults = false;

    try {
      for (const threadId of actionableThreadIds) {
        await action(threadId);
        shouldRefreshSearchResults = true;
      }
    } catch (error) {
      actionError = error;
    } finally {
      setThreadActionsPending(actionableThreadIds, false);
    }

    if (shouldRefreshSearchResults) {
      try {
        await refreshSearchResultsIfNeeded();
      } catch (refreshError) {
        if (!actionError) {
          throw refreshError;
        }
      }
    }

    if (actionError) {
      throw actionError;
    }
  };

  const markMessageAsRead = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsReadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markMessageAsUnread = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsUnreadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markMessageAsSpam = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await markMessageAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markThreadAsRead = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsReadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const markThreadAsUnread = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsUnreadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const updateMessageLabels = async (messageId: string, changes: LabelChangeSet) => {
    await runMessageAction(messageId, async () => {
      await updateMessageLabelsInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
        changes,
      );
    });
  };

  const updateThreadLabels = async (threadId: string, changes: LabelChangeSet) => {
    await runThreadAction(threadId, async () => {
      await updateThreadLabelsInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
        changes,
      );
    });
  };

  const moveMessageToTrash = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await moveMessageToTrashInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const moveThreadToTrash = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await moveThreadToTrashInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const untrashMessage = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await untrashMessageInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const untrashThread = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await untrashThreadInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const unsubscribeFromMessage = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await unsubscribeFromMessageMutation(messageId);
    });
  };

  const unmarkMessageAsSpam = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await unmarkMessageAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const markThreadAsSpam = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await markThreadAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const unmarkThreadAsSpam = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await unmarkThreadAsSpamInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
      );
    });
  };

  const deleteDraft = async (message: MessageListItem) => {
    if (!message.draftId) return;

    await runMessageAction(message.id, async () => {
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        message.id,
        message.draftId!,
      );
    });
  };

  const deleteMessagePermanently = async (messageId: string) => {
    await runMessageAction(messageId, async () => {
      await deleteMessagePermanentlyInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        messageId,
      );
    });
  };

  const deleteThreadPermanently = async (threadId: string) => {
    await runThreadAction(threadId, async () => {
      await deleteThreadPermanentlyInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        threadId,
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

  const markThreadsAsRead = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsReadInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const markThreadsAsUnread = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsUnreadInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const markThreadsAsSpam = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await markThreadAsSpamInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const unmarkThreadsAsSpam = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await unmarkThreadAsSpamInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const moveThreadsToTrash = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await moveThreadToTrashInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  const deleteThreadsPermanently = async (threads: ThreadListEntry[]) => {
    await runBulkThreadAction(
      threads.map((thread) => thread.threadId),
      async (threadId) => {
        await deleteThreadPermanentlyInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          threadId,
        );
      },
    );
  };

  return {
    deleteDraft,
    deleteDrafts,
    deleteMessagePermanently,
    deleteThreadPermanently,
    deleteThreadsPermanently,
    markMessageAsRead,
    markMessageAsSpam,
    markMessageAsUnread,
    markThreadAsRead,
    markThreadAsSpam,
    markThreadsAsRead,
    markThreadsAsSpam,
    markThreadsAsUnread,
    markThreadAsUnread,
    moveMessageToTrash,
    moveThreadToTrash,
    moveThreadsToTrash,
    unmarkMessageAsSpam,
    unmarkThreadAsSpam,
    unmarkThreadsAsSpam,
    unsubscribeFromMessage,
    untrashMessage,
    untrashThread,
    updateMessageLabels,
    updateThreadLabels,
  };
};

export type MailboxActions = ReturnType<typeof createMailboxActionHandlers>;
