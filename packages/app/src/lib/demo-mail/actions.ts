import { ORPCError } from "@orpc/client";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import type { MailboxActions } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { MAILBOX_LABELS } from "@quieter/app/lib/mail";
import type { MessageListItem } from "@quieter/app/lib/mail";
import {
  applyMessageLabelChangesLocally,
  getMailCommandUpdater,
} from "@quieter/app/lib/mail/inbox-query/data";
import { formatMailSender } from "@quieter/mail/compose/sender";
import type { MailCommand } from "@quieter/mail/data-plane";
import type { MailSnoozeCommand, MailSnoozeState } from "@quieter/mail/snooze";
import { getUnsubscribeKey } from "@quieter/mail/unsubscribe";

export type DemoMessageStore = {
  updateMessages: (
    update: (messages: MessageListItem[]) => MessageListItem[]
  ) => void;
};

export type DemoSnoozeSchedule = {
  hiddenMessageIds: string[];
  knownIncomingMessageIds: string[];
  state: MailSnoozeState;
};

type DemoSnoozeData = {
  messages: MessageListItem[];
  snoozes: Partial<Record<string, DemoSnoozeSchedule>>;
};

export type DemoSnoozeStore = DemoMessageStore & {
  mailboxId: string;
  updateSnoozes: (update: (state: DemoSnoozeData) => DemoSnoozeData) => void;
};

export const reconcileDemoSnoozes = ({
  messages,
  snoozes,
}: DemoSnoozeData): DemoSnoozeData => {
  const nextSchedules = { ...snoozes };
  for (const [threadId, schedule] of Object.entries(nextSchedules)) {
    if (
      schedule === undefined ||
      !["active", "suspended"].includes(schedule.state.status)
    ) {
      continue;
    }
    const newReply = messages.some(
      (message) =>
        message.threadId === threadId &&
        !schedule.knownIncomingMessageIds.includes(message.id) &&
        message.labelIds?.includes(MAILBOX_LABELS.inbox) === true &&
        !message.labelIds.some((id) =>
          ["SENT", "DRAFT", "SPAM", "TRASH"].includes(id)
        )
    );
    if (newReply) {
      nextSchedules[threadId] = {
        ...schedule,
        state: {
          ...schedule.state,
          status: "superseded",
          version: schedule.state.version + 1,
        },
      };
    }
  }
  return {
    messages: messages.map((message) => {
      const schedule = nextSchedules[message.threadId];
      return schedule === undefined
        ? message
        : { ...message, snooze: schedule.state };
    }),
    snoozes: nextSchedules,
  };
};

export const createDemoActions = (
  store: DemoSnoozeStore,
  invalidate: () => Promise<void>,
  placementScope: MailboxActions["placementScope"] = "personal"
): MailboxActions => {
  const applySnooze = async (
    threadIds: string[],
    command: MailSnoozeCommand,
    expectedVersions?: ReadonlyMap<string, number | null>
  ) => {
    store.updateSnoozes(({ messages, snoozes }) => {
      const nextSchedules = { ...snoozes };
      let nextMessages = messages;
      for (const threadId of threadIds) {
        const thread = nextMessages.filter(
          (message) => message.threadId === threadId
        );
        const previous = nextSchedules[threadId];
        if (
          expectedVersions &&
          expectedVersions.get(threadId) !== (previous?.state.version ?? null)
        ) {
          throw new ORPCError("CONFLICT", {
            message: "This snooze changed. Refresh before trying again.",
          });
        }
        if (
          thread.length === 0 ||
          thread.some(
            (message) =>
              message.labelIds?.some((id) =>
                ["DRAFT", "SPAM", "TRASH"].includes(id)
              ) === true
          )
        ) {
          throw new ORPCError("CONFLICT", {
            message:
              "This conversation cannot be snoozed. Refresh before trying again.",
          });
        }
        if (
          command.kind === "snooze" &&
          previous !== undefined &&
          [
            "active",
            "suspended",
            "preparing",
            "returning",
            "uncertain",
          ].includes(previous.state.status)
        ) {
          throw new ORPCError("CONFLICT", {
            message:
              "This conversation is already snoozed. Reschedule it instead.",
          });
        }
        const hiddenMessageIds =
          command.kind === "snooze"
            ? thread
                .filter(
                  (message) =>
                    message.labelIds?.includes(MAILBOX_LABELS.inbox) === true &&
                    !message.labelIds.includes(MAILBOX_LABELS.sent)
                )
                .map((message) => message.id)
            : previous?.hiddenMessageIds;
        if (
          hiddenMessageIds === undefined ||
          hiddenMessageIds.length === 0 ||
          (command.kind !== "snooze" &&
            (previous === undefined ||
              !["active", "suspended", "failed", "uncertain"].includes(
                previous.state.status
              )))
        ) {
          throw new ORPCError("CONFLICT", {
            message: "This conversation changed. Refresh before trying again.",
          });
        }
        const schedule =
          command.kind === "snooze" || command.kind === "reschedule"
            ? command
            : previous?.state;
        if (
          schedule === undefined ||
          ((command.kind === "snooze" || command.kind === "reschedule") &&
            new Date(schedule.returnAt).getTime() <= Date.now())
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Choose a time in the future.",
          });
        }
        let status: MailSnoozeState["status"] = "active";
        if (command.kind === "cancel") {
          status = "cancelled";
        } else if (command.kind === "return-now") {
          status = "returned";
        }
        const state: MailSnoozeState = {
          id: previous?.state.id ?? crypto.randomUUID(),
          mailboxId: store.mailboxId,
          returnAt: schedule.returnAt,
          status,
          threadId,
          timeZone: schedule.timeZone,
          version: (previous?.state.version ?? 0) + 1,
        };
        nextSchedules[threadId] = {
          hiddenMessageIds,
          knownIncomingMessageIds:
            command.kind === "snooze"
              ? thread
                  .filter(
                    (message) =>
                      message.labelIds?.includes(MAILBOX_LABELS.sent) !==
                        true && !message.draftId
                  )
                  .map((message) => message.id)
              : (previous?.knownIncomingMessageIds ?? []),
          state,
        };
        const hidden = new Set(hiddenMessageIds);
        nextMessages = nextMessages.map((message) => {
          if (message.threadId !== threadId) {
            return message;
          }
          let placement: "done" | "inbox" | undefined;
          if (hidden.has(message.id)) {
            if (command.kind === "snooze") {
              placement = "done";
            } else if (command.kind === "return-now") {
              placement = "inbox";
            }
          }
          return {
            ...(placement
              ? getMailCommandUpdater({ kind: "set-placement", placement })(
                  message
                )
              : message),
            snooze: state,
          };
        });
      }
      return { messages: nextMessages, snoozes: nextSchedules };
    });
    await invalidate();
  };
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
        if (
          command.kind === "set-importance" &&
          (message.labelIds?.some(
            (id) => id === MAILBOX_LABELS.sent || id === MAILBOX_LABELS.drafts
          ) ??
            false)
        ) {
          return [message];
        }
        return [update(message)];
      })
    );
    await invalidate();
  };
  return {
    applyThreadSnooze: async (threadId, command, expectedVersion) => {
      await applySnooze(
        [threadId],
        command,
        expectedVersion === undefined
          ? undefined
          : new Map([[threadId, expectedVersion]])
      );
    },
    applyThreadsSnooze: async (threads, command) => {
      await applySnooze(
        threads.map((thread) => thread.threadId),
        command,
        new Map(
          threads.map((thread) => [
            thread.threadId,
            thread.anchorMessage.snooze?.version ?? null,
          ])
        )
      );
    },
    canMarkRead: true,
    canSetImportance: true,
    canSetPlacement: true,
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
    markThreadDone: async (id) => {
      await apply([id], "thread", { kind: "set-placement", placement: "done" });
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
    markThreadsDone: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { kind: "set-placement", placement: "done" }
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
    placementScope,
    returnThreadToInbox: async (id) => {
      await apply([id], "thread", {
        kind: "set-placement",
        placement: "inbox",
      });
    },
    returnThreadsToInbox: async (threads) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { kind: "set-placement", placement: "inbox" }
      );
    },
    setThreadImportance: async (id, important) => {
      await apply([id], "thread", { important, kind: "set-importance" });
    },
    setThreadsImportance: async (threads, important) => {
      await apply(
        threads.map((thread) => thread.threadId),
        "thread",
        { important, kind: "set-importance" }
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
    unsubscribeFromMessage: async (id) => {
      let newlyRequested = false;
      store.updateMessages((messages) => {
        const selected = messages.find((message) => message.id === id);
        const key =
          selected?.unsubscribeKey ??
          getUnsubscribeKey([{ name: "From", value: selected?.from ?? "" }]);
        if (
          !key ||
          !selected?.unsubscribeMailto ||
          selected.unsubscribeStatus === "requested"
        ) {
          return messages;
        }
        newlyRequested = true;
        return messages.map((message) =>
          (message.unsubscribeKey ??
            getUnsubscribeKey([
              { name: "From", value: message.from ?? "" },
            ])) === key
            ? {
                ...message,
                unsubscribeKey: key,
                unsubscribeStatus: "requested",
              }
            : message
        );
      });
      await invalidate();
      return newlyRequested;
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
    senderName?: string;
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
      attachments: draft.attachments.map((attachment) => ({
        attachmentId: attachment.gmailAttachmentId ?? attachment.id,
        fileName: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      bodyHtml: draft.bodyHtml,
      bodyText: draft.bodyText,
      date: new Date(now).toISOString(),
      draftId,
      from: formatMailSender({
        address: store.sender,
        name: draft.senderName?.trim() || store.senderName || "",
      }),
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
      attachments: draft.attachments.map((attachment) => ({
        attachmentId: attachment.gmailAttachmentId ?? attachment.id,
        fileName: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      bodyHtml: draft.bodyHtml,
      bodyText: draft.bodyText,
      date: new Date().toISOString(),
      from: formatMailSender({
        address: store.sender,
        name: draft.senderName?.trim() || store.senderName || "",
      }),
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
