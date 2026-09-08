import { ORPCError } from "@orpc/client";
import type { MailCommand } from "@quieter/mail/data-plane";

import type { ComposeDraftState } from "#/features/compose/domain/draft";
import type { MailboxActions } from "#/features/mailbox/components/mailbox-action-handlers";
import {
  applyMessageLabelChangesLocally,
  getMailCommandUpdater,
} from "#/lib/gmail/inbox-query/data";
import { MAILBOX_LABELS } from "#/lib/mail";
import type { MessageListItem } from "#/lib/mail";

export type DemoMessageStore = {
  updateMessages: (
    update: (messages: MessageListItem[]) => MessageListItem[]
  ) => void;
};

export const createDemoActions = (
  store: DemoMessageStore,
  invalidate: () => Promise<void>
): MailboxActions => {
  const apply = async (
    ids: string[],
    scope: "message" | "thread",
    command: MailCommand
  ) => {
    const selected = new Set(ids);
    const update = getMailCommandUpdater(command);
    store.updateMessages((messages) =>
      messages.flatMap((message) => {
        if (
          !selected.has(scope === "message" ? message.id : message.threadId)
        ) {
          return [message];
        }
        if (command.kind === "delete-permanently") {
          return message.draftId !== undefined ||
            message.labelIds?.includes(MAILBOX_LABELS.drafts) === true
            ? []
            : [message];
        }
        return [update(message)];
      })
    );
    await invalidate();
  };
  return {
    archiveMessage: async (id) => {
      await apply([id], "message", { destination: "archive", kind: "move" });
    },
    archiveThread: async (id) => {
      await apply([id], "thread", { destination: "archive", kind: "move" });
    },
    archiveThreads: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { destination: "archive", kind: "move" }
      );
    },
    deleteDraft: async (message) => {
      await apply([message.id], "message", { kind: "delete-permanently" });
    },
    deleteDrafts: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { kind: "delete-permanently" }
      );
    },
    markMessageAsRead: async (id) => {
      await apply([id], "message", { kind: "set-read", read: true });
    },
    markMessageAsSpam: async (id) => {
      await apply([id], "message", { destination: "spam", kind: "move" });
    },
    markMessageAsUnread: async (id) => {
      await apply([id], "message", { kind: "set-read", read: false });
    },
    markThreadAsRead: async (id) => {
      await apply([id], "thread", { kind: "set-read", read: true });
    },
    markThreadAsSpam: async (id) => {
      await apply([id], "thread", { destination: "spam", kind: "move" });
    },
    markThreadAsUnread: async (id) => {
      await apply([id], "thread", { kind: "set-read", read: false });
    },
    markThreadsAsRead: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { kind: "set-read", read: true }
      );
    },
    markThreadsAsSpam: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { destination: "spam", kind: "move" }
      );
    },
    markThreadsAsUnread: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { kind: "set-read", read: false }
      );
    },
    moveMessageToTrash: async (id) => {
      await apply([id], "message", { destination: "trash", kind: "move" });
    },
    moveThreadToTrash: async (id) => {
      await apply([id], "thread", { destination: "trash", kind: "move" });
    },
    moveThreadsToTrash: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { destination: "trash", kind: "move" }
      );
    },
    unmarkMessageAsSpam: async (id) => {
      await apply([id], "message", { destination: "inbox", kind: "move" });
    },
    unmarkThreadAsSpam: async (id) => {
      await apply([id], "thread", { destination: "inbox", kind: "move" });
    },
    unmarkThreadsAsSpam: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { destination: "inbox", kind: "move" }
      );
    },
    // oxlint-disable-next-line require-await -- Keep the same rejected-Promise contract as live actions.
    unsubscribeFromMessage: async () => {
      throw new ORPCError("BAD_REQUEST", {
        message: "Unsubscribing is unavailable in the demo.",
      });
    },
    untrashMessage: async (id) => {
      await apply([id], "message", { destination: "inbox", kind: "move" });
    },
    untrashThread: async (id) => {
      await apply([id], "thread", { destination: "inbox", kind: "move" });
    },
    untrashThreads: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { destination: "inbox", kind: "move" }
      );
    },
    updateMessageLabels: async (id, changes) => {
      await apply([id], "message", {
        addIds: changes.addLabelIds ?? [],
        kind: "set-labels",
        removeIds: changes.removeLabelIds ?? [],
      });
    },
    updateThreadLabels: async (id, changes) => {
      await apply([id], "thread", {
        addIds: changes.addLabelIds ?? [],
        kind: "set-labels",
        removeIds: changes.removeLabelIds ?? [],
      });
    },
    updateThreadsLabels: async (updates) => {
      const changes = new Map(
        updates.map((update) => [update.threadId, update])
      );
      store.updateMessages((messages) =>
        messages.map((message) => {
          const change = changes.get(message.threadId);
          return change === undefined
            ? message
            : applyMessageLabelChangesLocally(message, change);
        })
      );
      await invalidate();
    },
  };
};

export const createDemoComposeActions = (
  store: DemoMessageStore & {
    sender: string;
    prefix: string;
  }
) => ({
  deleteDraft: (draft: ComposeDraftState) => {
    store.updateMessages((messages) =>
      messages.filter(
        (message) =>
          !(draft.messageId && message.id === draft.messageId) &&
          !(draft.draftId && message.draftId === draft.draftId)
      )
    );
  },
  saveDraft: (draft: ComposeDraftState): ComposeDraftState => {
    const now = Date.now();
    const messageId =
      draft.messageId ?? `${store.prefix}-draft-message-${draft.localId}`;
    const draftId = draft.draftId ?? `${store.prefix}-draft-${draft.localId}`;
    const message: MessageListItem = {
      bodyHtml: draft.bodyHtml,
      bodyText: draft.bodyText,
      date: new Date(now).toISOString(),
      draftId,
      from: store.sender,
      id: messageId,
      isUnread: false,
      labelIds: [MAILBOX_LABELS.drafts],
      snippet: draft.bodyText || draft.subject,
      subject: draft.subject,
      threadId: draft.replyContext?.threadId ?? messageId,
      to: draft.recipients.to,
    };
    store.updateMessages((messages) => [
      ...messages.filter((entry) => entry.id !== messageId),
      message,
    ]);
    return {
      ...draft,
      draftId,
      errorMessage: null,
      lastSavedAt: now,
      messageId,
      saveStatus: "saved",
      updatedAt: now,
    };
  },
  sendDraft: (draft: ComposeDraftState) => {
    const id = `${store.prefix}-sent-${crypto.randomUUID()}`;
    const message: MessageListItem = {
      bodyHtml: draft.bodyHtml,
      bodyText: draft.bodyText,
      date: new Date().toISOString(),
      from: store.sender,
      id,
      isUnread: false,
      labelIds: [MAILBOX_LABELS.sent],
      snippet: draft.bodyText || draft.subject,
      subject: draft.subject,
      threadId: draft.replyContext?.threadId ?? id,
      to: draft.recipients.to,
    };
    store.updateMessages((messages) => [
      ...messages.filter(
        (entry) =>
          !(draft.messageId && entry.id === draft.messageId) &&
          !(draft.draftId && entry.draftId === draft.draftId)
      ),
      message,
    ]);
    return { id, threadId: message.threadId };
  },
});
