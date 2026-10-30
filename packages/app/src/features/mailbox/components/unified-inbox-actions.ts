"use client";

import type {
  MailboxActions,
  MailboxPendingActions,
} from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import type { MessageListMailboxContext } from "@quieter/app/features/message-list/components/message-list-types";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import type { MessageListItem } from "@quieter/app/lib/mail";

type MessageAction =
  | "archiveMessage"
  | "markMessageAsRead"
  | "markMessageAsSpam"
  | "markMessageAsUnread"
  | "moveMessageToTrash"
  | "unmarkMessageAsSpam"
  | "unsubscribeFromMessage"
  | "untrashMessage";
type ThreadAction =
  | "archiveThread"
  | "markThreadAsRead"
  | "markThreadAsSpam"
  | "markThreadAsUnread"
  | "moveThreadToTrash"
  | "unmarkThreadAsSpam"
  | "untrashThread";
type BulkAction =
  | "archiveThreads"
  | "deleteDrafts"
  | "markThreadsAsRead"
  | "markThreadsAsSpam"
  | "markThreadsAsUnread"
  | "moveThreadsToTrash"
  | "unmarkThreadsAsSpam"
  | "untrashThreads";

export const createUnifiedInboxActions = ({
  contextsByThreadId,
  originalThreadById,
  originalMessageById,
}: {
  contextsByThreadId: ReadonlyMap<string, MessageListMailboxContext>;
  originalThreadById: ReadonlyMap<string, ThreadListEntry>;
  originalMessageById: ReadonlyMap<string, MessageListItem>;
}): {
  mailboxActions: MailboxActions;
  mailboxContextsByThreadId: ReadonlyMap<string, MessageListMailboxContext>;
  pendingActions: MailboxPendingActions;
} => {
  const contextsByMessageId = new Map<string, MessageListMailboxContext>();
  for (const context of contextsByThreadId.values()) {
    for (const id of context.originalMessageIds.keys()) {
      contextsByMessageId.set(id, context);
    }
  }
  const runMessageAction = async (action: MessageAction, id: string) => {
    const context = contextsByMessageId.get(id);
    const message = originalMessageById.get(id);
    if (!context || !message) {
      throw new Error(
        "This message is no longer available. Refresh your inboxes."
      );
    }
    return await context.mailboxActions[action](message.id);
  };
  const runThreadAction = async (action: ThreadAction, id: string) => {
    const context = contextsByThreadId.get(id);
    const thread = originalThreadById.get(id);
    if (!context || !thread) {
      throw new Error(
        "This conversation is no longer available. Refresh your inboxes."
      );
    }
    await context.mailboxActions[action](thread.threadId);
  };
  const runBulkAction = async (
    action: BulkAction,
    threads: ThreadListEntry[]
  ) => {
    const groups = new Map<
      string,
      { context: MessageListMailboxContext; threads: ThreadListEntry[] }
    >();
    for (const selected of threads) {
      const context = contextsByThreadId.get(selected.threadId);
      const thread = originalThreadById.get(selected.threadId);
      if (!context || !thread) {
        throw new Error(
          "A selected conversation is no longer available. Refresh your inboxes."
        );
      }
      if (
        (action === "markThreadsAsRead" || action === "markThreadsAsUnread") &&
        !context.mailboxActions.canMarkRead
      ) {
        throw new Error("You cannot change read status in a selected inbox.");
      }
      const group = groups.get(context.mailboxId) ?? { context, threads: [] };
      group.threads.push(thread);
      groups.set(context.mailboxId, group);
    }
    let firstError: unknown;
    for (const { context, threads: sourceThreads } of groups.values()) {
      try {
        await context.mailboxActions[action](sourceThreads);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) {
      throw firstError instanceof Error
        ? firstError
        : new Error("Could not update some inboxes.", { cause: firstError });
    }
  };
  const mailboxActions: MailboxActions = {
    archiveMessage: async (id) => {
      await runMessageAction("archiveMessage", id);
    },
    archiveThread: async (id) => {
      await runThreadAction("archiveThread", id);
    },
    archiveThreads: async (threads) => {
      await runBulkAction("archiveThreads", threads);
    },
    get canMarkRead() {
      return [...contextsByThreadId.values()].some(
        (context) => context.mailboxActions.canMarkRead
      );
    },
    get canSetImportance() {
      return [...contextsByThreadId.values()].some(
        (context) => context.mailboxActions.canSetImportance
      );
    },
    deleteDraft: async (message) => {
      const context = contextsByMessageId.get(message.id);
      const original = originalMessageById.get(message.id);
      if (!context || !original) {
        throw new Error(
          "This draft is no longer available. Refresh your inboxes."
        );
      }
      await context.mailboxActions.deleteDraft(original);
    },
    deleteDrafts: async (threads) => {
      await runBulkAction("deleteDrafts", threads);
    },
    markMessageAsRead: async (id) => {
      await runMessageAction("markMessageAsRead", id);
    },
    markMessageAsSpam: async (id) => {
      await runMessageAction("markMessageAsSpam", id);
    },
    markMessageAsUnread: async (id) => {
      await runMessageAction("markMessageAsUnread", id);
    },
    markThreadAsRead: async (id) => {
      await runThreadAction("markThreadAsRead", id);
    },
    markThreadAsSpam: async (id) => {
      await runThreadAction("markThreadAsSpam", id);
    },
    markThreadAsUnread: async (id) => {
      await runThreadAction("markThreadAsUnread", id);
    },
    markThreadsAsRead: async (threads) => {
      await runBulkAction("markThreadsAsRead", threads);
    },
    markThreadsAsSpam: async (threads) => {
      await runBulkAction("markThreadsAsSpam", threads);
    },
    markThreadsAsUnread: async (threads) => {
      await runBulkAction("markThreadsAsUnread", threads);
    },
    moveMessageToTrash: async (id) => {
      await runMessageAction("moveMessageToTrash", id);
    },
    moveThreadToTrash: async (id) => {
      await runThreadAction("moveThreadToTrash", id);
    },
    moveThreadsToTrash: async (threads) => {
      await runBulkAction("moveThreadsToTrash", threads);
    },
    setThreadImportance: async (id, important) => {
      const context = contextsByThreadId.get(id);
      const original = originalThreadById.get(id);
      if (!context || !original) {
        throw new Error("This conversation is no longer available.");
      }
      await context.mailboxActions.setThreadImportance(
        original.threadId,
        important
      );
    },
    setThreadsImportance: async (threads, important) => {
      const groups = new Map<
        string,
        { context: MessageListMailboxContext; threads: ThreadListEntry[] }
      >();
      for (const thread of threads) {
        const context = contextsByThreadId.get(thread.threadId);
        const original = originalThreadById.get(thread.threadId);
        if (!context || !original || !context.mailboxActions.canSetImportance) {
          throw new Error("A selected conversation cannot be updated.");
        }
        const group = groups.get(context.mailboxId) ?? { context, threads: [] };
        group.threads.push(original);
        groups.set(context.mailboxId, group);
      }
      const results = await Promise.allSettled(
        [...groups.values()].map(async ({ context, threads: originals }) => {
          await context.mailboxActions.setThreadsImportance(
            originals,
            important
          );
        })
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        throw failure.reason;
      }
    },
    unmarkMessageAsSpam: async (id) => {
      await runMessageAction("unmarkMessageAsSpam", id);
    },
    unmarkThreadAsSpam: async (id) => {
      await runThreadAction("unmarkThreadAsSpam", id);
    },
    unmarkThreadsAsSpam: async (threads) => {
      await runBulkAction("unmarkThreadsAsSpam", threads);
    },
    unsubscribeFromMessage: async (id) =>
      (await runMessageAction("unsubscribeFromMessage", id)) === true,
    untrashMessage: async (id) => {
      await runMessageAction("untrashMessage", id);
    },
    untrashThread: async (id) => {
      await runThreadAction("untrashThread", id);
    },
    untrashThreads: async (threads) => {
      await runBulkAction("untrashThreads", threads);
    },
    updateMessageLabels: async (id, changes) => {
      const context = contextsByMessageId.get(id);
      const original = originalMessageById.get(id);
      if (!context || !original) {
        throw new Error(
          "This message is no longer available. Refresh your inboxes."
        );
      }
      await context.mailboxActions.updateMessageLabels(original.id, changes);
    },
    updateThreadLabels: async (id, changes) => {
      const context = contextsByThreadId.get(id);
      const original = originalThreadById.get(id);
      if (!context || !original) {
        throw new Error(
          "This conversation is no longer available. Refresh your inboxes."
        );
      }
      await context.mailboxActions.updateThreadLabels(
        original.threadId,
        changes
      );
    },
    updateThreadsLabels: async (updates) => {
      const groups = new Map<
        string,
        {
          context: MessageListMailboxContext;
          updates: Parameters<
            MailboxActions["updateThreadsLabels"]
          >[0][number][];
        }
      >();
      for (const update of updates) {
        const context = contextsByThreadId.get(update.threadId);
        const original = originalThreadById.get(update.threadId);
        if (!context || !original) {
          throw new Error(
            "A selected conversation is no longer available. Refresh your inboxes."
          );
        }
        const group = groups.get(context.mailboxId) ?? { context, updates: [] };
        group.updates.push({ ...update, threadId: original.threadId });
        groups.set(context.mailboxId, group);
      }
      let firstError: unknown;
      for (const { context, updates: sourceUpdates } of groups.values()) {
        try {
          await context.mailboxActions.updateThreadsLabels(sourceUpdates);
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) {
        throw firstError instanceof Error
          ? firstError
          : new Error("Could not update labels in some inboxes.", {
              cause: firstError,
            });
      }
    },
  };
  const pendingActions: MailboxPendingActions = {
    isMessageActionPending: (id) => {
      const context = id ? contextsByMessageId.get(id) : undefined;
      const original = id ? originalMessageById.get(id) : undefined;
      return (
        context !== undefined &&
        original !== undefined &&
        context.pendingActions.isMessageActionPending(original.id)
      );
    },
    isThreadActionPending: (id) => {
      const context = id ? contextsByThreadId.get(id) : undefined;
      const original = id ? originalThreadById.get(id) : undefined;
      return (
        context !== undefined &&
        original !== undefined &&
        context.pendingActions.isThreadActionPending(original.threadId)
      );
    },
  };
  const mailboxContextsByThreadId = new Map<
    string,
    MessageListMailboxContext
  >();
  for (const [id, context] of contextsByThreadId) {
    mailboxContextsByThreadId.set(id, {
      ...context,
      mailboxActions: {
        ...mailboxActions,
        get canMarkRead() {
          return context.mailboxActions.canMarkRead;
        },
        get canSetImportance() {
          return context.mailboxActions.canSetImportance;
        },
      },
      pendingActions,
    });
  }
  return { mailboxActions, mailboxContextsByThreadId, pendingActions };
};
