"use client";

import {
  CheckmarkCircle02Icon,
  InboxIcon,
  Flag01Icon,
  Delete01Icon,
  Delete02Icon,
  Mail01Icon,
  MailOpen02Icon,
} from "@hugeicons/core-free-icons";
import {
  omitDisabledHotkeys,
  shouldIgnoreAppShortcut,
} from "@quieter/app/features/hotkeys/domain/hotkey-guards";
import { MessageListHeader } from "@quieter/app/features/message-list/components/message-list-header";
import { MessageListScrollPane } from "@quieter/app/features/message-list/components/message-list-scroll-pane";
import { MessageListSelectionToolbar } from "@quieter/app/features/message-list/components/message-list-selection-toolbar";
import type {
  MessageListBulkAction,
  MessageListBulkLabels,
  MessageListProps,
} from "@quieter/app/features/message-list/components/message-list-types";
import { useMessageListSelection } from "@quieter/app/features/message-list/components/use-message-list-selection";
import { MessageListSearch } from "@quieter/app/features/message-search/components/message-list-search";
import {
  appEaseOut,
  appMotionDuration,
} from "@quieter/app/features/motion/app-motion";
import { toastError } from "@quieter/app/lib/error-toast";
import { buildThreadListEntries } from "@quieter/app/lib/gmail/thread-list";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import { labelsQueryOptions } from "@quieter/app/lib/mail/labels-query";
import { toast } from "@quieter/ui/toast";
import { useHotkeys } from "@tanstack/react-hotkeys";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { useQueries } from "@tanstack/react-query";
import { m, useReducedMotion } from "motion/react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { useMessageListCommands } from "./use-message-list-commands";

const buildDraftListEntry = (
  message: MessageListItem,
  useScopedThreadId: boolean
): ThreadListEntry => ({
  anchorMessage: message,
  attachmentCount:
    message.threadAttachmentCount ?? message.attachments?.length ?? 0,
  attachmentNames:
    message.threadAttachmentNames ??
    message.attachments?.map((attachment) => attachment.fileName) ??
    [],
  isImportant: false,
  messageCount: Math.max(1, message.threadMessageCount ?? 0),
  messages: [message],
  participants: [],
  preview: message.snippet?.trim() ?? "",
  subject: message.subject?.trim() ?? "(No subject)",
  threadId: useScopedThreadId
    ? message.threadId
    : (message.draftId ?? message.id),
  threadLabelIds: message.threadLabelIds ?? message.labelIds ?? [],
  unreadCount: 0,
});

const formatConversationCount = (count: number) =>
  `${count} ${count === 1 ? "conversation" : "conversations"}`;

/**
 * One source of truth for action feedback, so a menu click and its keyboard
 * shortcut always confirm the same thing.
 */
const threadActionSuccessMessage = {
  deleteDrafts: (threads: ThreadListEntry[]) =>
    `${threads.length} ${threads.length === 1 ? "draft" : "drafts"} deleted.`,
  markRead: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} marked as Read.`,
  markSpam: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} marked as Spam.`,
  markUnread: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} marked as Unread.`,
  moveToTrash: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} moved to Trash.`,
  unmarkSpam: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} removed from Spam.`,
} as const;

const DONE_BULK_ACTION_IDS: ReadonlySet<string> = new Set([
  "mark-threads-done",
  "return-threads-to-inbox",
]);

type MessageListHotkeyContext = {
  actionHotkeysEnabled: boolean;
  bulkActions: MessageListBulkAction[];
  canMarkRead: boolean;
  activeMailbox: MailboxCategory;
  activeMessageId: string | null | undefined;
  listNavigationHotkeysEnabled: boolean;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxProvider: MessageListProps["mailboxProvider"];
  onDeactivateActiveMessage: MessageListProps["onDeactivateActiveMessage"];
  openAdjacentThread: (offset: 1 | -1) => void;
  openBulkLabels: () => void;
  openFocusedThread: () => void;
  runActionThreads: (
    action: (threads: ThreadListEntry[]) => void | Promise<void>,
    successMessage: (threads: ThreadListEntry[]) => string
  ) => Promise<void>;
  selection: ReturnType<typeof useMessageListSelection>;
  threadedMessages: ThreadListEntry[];
  userLabels: { type: string }[];
};

const buildMessageListHotkeys = (
  context: MessageListHotkeyContext
): UseHotkeyDefinition[] => [
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      if ((context.activeMessageId?.trim() ?? "") !== "") {
        context.openAdjacentThread(1);
        return;
      }
      context.selection.focusThreadByOffset(1);
    },
    hotkey: "J",
    options: { enabled: context.threadedMessages.length > 0 },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      if ((context.activeMessageId?.trim() ?? "") !== "") {
        context.openAdjacentThread(-1);
        return;
      }
      context.selection.focusThreadByOffset(-1);
    },
    hotkey: "K",
    options: { enabled: context.threadedMessages.length > 0 },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      context.openFocusedThread();
    },
    hotkey: "O",
    options: { enabled: context.listNavigationHotkeysEnabled },
  },
  {
    callback: (event: KeyboardEvent) => {
      const control =
        event.target instanceof Element
          ? event.target.closest(
              "button, a[href], input, select, textarea, summary, [role='button'], [role='link']"
            )
          : null;
      if (
        event.defaultPrevented ||
        shouldIgnoreAppShortcut(event) ||
        (control !== null && !control.matches("[data-message-row-trigger]"))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      context.openFocusedThread();
    },
    hotkey: "Enter",
    options: {
      enabled: context.listNavigationHotkeysEnabled,
      preventDefault: false,
      stopPropagation: false,
    },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      context.selection.toggleFocusedThreadSelection();
    },
    hotkey: "X",
    options: { enabled: context.listNavigationHotkeysEnabled },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      if ((context.activeMessageId?.trim() ?? "") !== "") {
        context.selection.requestFocusRing();
        context.onDeactivateActiveMessage();
        return;
      }
      context.selection.clearSelection();
    },
    hotkey: "U",
    options: {
      enabled:
        context.threadedMessages.length > 0 ||
        (context.activeMessageId?.trim() ?? "") !== "",
    },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.runActionThreads(
        context.mailboxActions.moveThreadsToTrash,
        threadActionSuccessMessage.moveToTrash
      );
    },
    hotkey: "Shift+3",
    options: {
      enabled:
        context.actionHotkeysEnabled &&
        context.mailboxProvider === "gmail" &&
        context.activeMailbox !== "trash",
    },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.runActionThreads(
        context.mailboxActions.markThreadsAsSpam,
        threadActionSuccessMessage.markSpam
      );
    },
    hotkey: "Shift+1",
    options: {
      enabled:
        context.actionHotkeysEnabled &&
        context.mailboxProvider === "gmail" &&
        context.activeMailbox === "inbox",
    },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.runActionThreads(
        context.mailboxActions.markThreadsAsRead,
        threadActionSuccessMessage.markRead
      );
    },
    hotkey: "Shift+I",
    options: { enabled: context.actionHotkeysEnabled && context.canMarkRead },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.runActionThreads(
        context.mailboxActions.markThreadsAsUnread,
        threadActionSuccessMessage.markUnread
      );
    },
    hotkey: "Shift+U",
    options: { enabled: context.actionHotkeysEnabled && context.canMarkRead },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      context.openBulkLabels();
    },
    hotkey: "L",
    options: {
      enabled: context.actionHotkeysEnabled && context.userLabels.length > 0,
    },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.bulkActions
        .find((action) => DONE_BULK_ACTION_IDS.has(action.id))
        ?.onSelect();
    },
    hotkey: "E",
    options: {
      enabled:
        context.actionHotkeysEnabled &&
        context.bulkActions.some((action) =>
          DONE_BULK_ACTION_IDS.has(action.id)
        ),
    },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.bulkActions
        .find((action) => action.id === "toggle-importance")
        ?.onSelect();
    },
    hotkey: "I",
    options: {
      enabled:
        context.actionHotkeysEnabled &&
        context.bulkActions.some((action) => action.id === "toggle-importance"),
    },
  },
];

const getActionThreads = (
  selectedThreads: ThreadListEntry[],
  focusedThread: ThreadListEntry | null
) => {
  if (selectedThreads.length > 0) {
    return selectedThreads;
  }
  if (focusedThread !== null) {
    return [focusedThread];
  }
  return [];
};

const buildMessageListBulkActions = ({
  activeMailbox,
  mailboxActions,
  mailboxProvider,
  runActionThreads,
  actionThreads,
  canSetImportance,
  canSetPlacement,
  sharedPlacement,
  canMarkRead,
}: {
  actionThreads: ThreadListEntry[];
  canSetImportance: boolean;
  canSetPlacement: boolean;
  sharedPlacement: boolean;
  canMarkRead: boolean;
  activeMailbox: MailboxCategory;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxProvider: MessageListProps["mailboxProvider"];
  runActionThreads: (
    action: (threads: ThreadListEntry[]) => void | Promise<void>,
    successMessage: (threads: ThreadListEntry[]) => string
  ) => Promise<void>;
}): MessageListBulkAction[] => {
  if (mailboxProvider === "api") {
    return [];
  }

  if (activeMailbox === "drafts") {
    return [
      {
        destructive: true,
        icon: Delete02Icon,
        id: "delete-drafts",
        label: "Delete drafts",
        onSelect: async () => {
          await runActionThreads(
            mailboxActions.deleteDrafts,
            threadActionSuccessMessage.deleteDrafts
          );
        },
        promoted: true,
      },
    ];
  }

  const actions: MessageListBulkAction[] = [];
  if (
    canSetPlacement &&
    !["drafts", "sent", "spam", "trash"].includes(activeMailbox)
  ) {
    const returnToInbox = activeMailbox === "done";
    actions.push({
      icon: returnToInbox ? InboxIcon : CheckmarkCircle02Icon,
      id: returnToInbox ? "return-threads-to-inbox" : "mark-threads-done",
      label: `${returnToInbox ? "Return to Inbox" : "Done"}${sharedPlacement ? " for everyone" : ""}`,
      onSelect: async () => {
        await runActionThreads(
          returnToInbox
            ? mailboxActions.returnThreadsToInbox
            : mailboxActions.markThreadsDone,
          (threads) =>
            `${formatConversationCount(threads.length)} ${returnToInbox ? "returned to Inbox" : "marked Done"}.`
        );
      },
      promoted: true,
    });
  }
  if (canSetImportance) {
    const important =
      actionThreads.length > 0 &&
      actionThreads.every((thread) => thread.isImportant);
    actions.push({
      icon: Flag01Icon,
      id: "toggle-importance",
      label: important ? "Mark as not important" : "Mark as important",
      onSelect: async () => {
        await runActionThreads(
          async (threads) => {
            await mailboxActions.setThreadsImportance(threads, !important);
          },
          (threads) =>
            `${formatConversationCount(threads.length)} marked as ${important ? "not important" : "important"}.`
        );
      },
      promoted: true,
    });
  }

  if (canMarkRead) {
    actions.push(
      {
        icon: MailOpen02Icon,
        id: "mark-threads-read",
        label: "Mark as Read",
        onSelect: async () => {
          await runActionThreads(
            mailboxActions.markThreadsAsRead,
            threadActionSuccessMessage.markRead
          );
        },
        promoted: true,
      },
      {
        icon: Mail01Icon,
        id: "mark-threads-unread",
        label: "Mark as Unread",
        onSelect: async () => {
          await runActionThreads(
            mailboxActions.markThreadsAsUnread,
            threadActionSuccessMessage.markUnread
          );
        },
        promoted: true,
      }
    );
  }

  if (mailboxProvider === "gmail" && activeMailbox === "inbox") {
    actions.push({
      destructive: true,
      icon: Delete02Icon,
      id: "mark-threads-spam",
      label: "Mark as Spam",
      onSelect: async () => {
        await runActionThreads(
          mailboxActions.markThreadsAsSpam,
          threadActionSuccessMessage.markSpam
        );
      },
    });
  }

  if (mailboxProvider === "gmail" && activeMailbox === "spam") {
    actions.push({
      icon: Mail01Icon,
      id: "unmark-threads-spam",
      label: "Unmark as Spam",
      onSelect: async () => {
        await runActionThreads(
          mailboxActions.unmarkThreadsAsSpam,
          threadActionSuccessMessage.unmarkSpam
        );
      },
      promoted: true,
    });
  }

  if (mailboxProvider === "gmail" && activeMailbox !== "trash") {
    actions.push({
      destructive: true,
      icon: Delete01Icon,
      id: "move-threads-trash",
      label: "Move to Trash",
      onSelect: async () => {
        await runActionThreads(
          mailboxActions.moveThreadsToTrash,
          threadActionSuccessMessage.moveToTrash
        );
      },
      promoted: true,
    });
  }

  return actions;
};

type MessageListSelection = ReturnType<typeof useMessageListSelection>;

const useMessageListInteractions = ({
  actionMailboxProvider,
  activeThreadId,
  canFocusSearch,
  isSelecting,
  labelMailboxActions,
  labelMailboxId,
  onFocusSearch,
  props,
  selection,
  threadedMessages,
  userLabels,
}: {
  actionMailboxProvider: MessageListProps["mailboxProvider"];
  activeThreadId: string | null;
  canFocusSearch: boolean;
  isSelecting: boolean;
  labelMailboxActions: MessageListProps["mailboxActions"] | null;
  labelMailboxId: string | null;
  onFocusSearch: () => void;
  props: MessageListProps;
  selection: MessageListSelection;
  threadedMessages: ThreadListEntry[];
  userLabels: { type: string }[];
}) => {
  const [isBulkLabelsOpen, setIsBulkLabelsOpen] = useState(false);
  const actionThreads = getActionThreads(
    selection.selectedThreads,
    selection.focusedThread
  );
  const isBulkActionPending = actionThreads.some((thread) => {
    const pendingActions =
      props.mailboxContextsByThreadId?.get(thread.threadId)?.pendingActions ??
      props.pendingActions;
    return (
      pendingActions.isMessageActionPending(thread.anchorMessage.id) ||
      pendingActions.isThreadActionPending(thread.threadId)
    );
  });

  const runActionThreads = async (
    action: (threads: ThreadListEntry[]) => void | Promise<void>,
    successMessage: (threads: ThreadListEntry[]) => string
  ) => {
    const threads = getActionThreads(
      selection.selectedThreads,
      selection.focusedThread
    );
    if (threads.length === 0) {
      return;
    }
    if (
      props.mailboxContextsByThreadId !== undefined &&
      threads.some(
        (thread) =>
          props.mailboxContextsByThreadId?.has(thread.threadId) === false
      )
    ) {
      return;
    }

    try {
      await action(threads);
      toast.success(successMessage(threads));
      selection.clearSelection();
    } catch (error) {
      toastError(error, {
        boundary: "bulk-actions",
        fallback: "Could not update messages.",
      });
    }
  };
  const openBulkLabels = () => {
    if (userLabels.length === 0) {
      return;
    }

    if (
      selection.selectedThreads.length === 0 &&
      selection.focusedThread !== null
    ) {
      selection.selectSingleThread(selection.focusedThread.threadId);
    }

    setIsBulkLabelsOpen(true);
  };
  const markKeyboardOpenedThreadRead = (thread: ThreadListEntry) => {
    const context = props.mailboxContextsByThreadId?.get(thread.threadId);
    const pendingActions = context?.pendingActions ?? props.pendingActions;
    if (
      selection.selectedThreadIds.size === 0 &&
      thread.unreadCount > 0 &&
      (props.mailboxContextsByThreadId
        ? context?.mailboxActions.canMarkRead === true
        : props.mailboxActions.canMarkRead) &&
      !pendingActions.isMessageActionPending(thread.anchorMessage.id) &&
      !pendingActions.isThreadActionPending(thread.threadId)
    ) {
      void (async () => {
        try {
          await (
            context?.mailboxActions ?? props.mailboxActions
          ).markThreadAsRead(thread.threadId);
        } catch (error) {
          toastError(error, { boundary: "message-read-state" });
        }
      })();
    }
  };
  const openFocusedThread = () => {
    const thread = selection.focusedThread;
    if (thread !== null) {
      markKeyboardOpenedThreadRead(thread);
      if (props.activeMailbox !== "drafts") {
        props.onKeyboardOpenMessage?.();
      }
    }
    selection.openFocusedThread();
  };
  const activeThreadIndex =
    activeThreadId === null
      ? -1
      : threadedMessages.findIndex(
          (thread) => thread.threadId === activeThreadId
        );
  const openAdjacentThread = (offset: 1 | -1) => {
    const thread =
      activeThreadIndex === -1
        ? undefined
        : threadedMessages[activeThreadIndex + offset];
    if (thread === undefined) {
      return;
    }
    markKeyboardOpenedThreadRead(thread);
    props.onKeyboardOpenMessage?.();
    selection.openThread(thread);
  };

  const canMarkRead = actionThreads.every((thread) =>
    props.mailboxContextsByThreadId
      ? props.mailboxContextsByThreadId.get(thread.threadId)?.mailboxActions
          .canMarkRead === true
      : props.mailboxActions.canMarkRead
  );
  const hasActiveMessage = (props.activeMessageId?.trim() ?? "") !== "";
  const actionHotkeysEnabled =
    actionMailboxProvider !== "api" &&
    !hasActiveMessage &&
    props.activeMailbox !== "drafts";
  const listNavigationHotkeysEnabled =
    threadedMessages.length > 0 && !hasActiveMessage;
  const bulkActions = buildMessageListBulkActions({
    actionThreads,
    activeMailbox: props.activeMailbox,
    canMarkRead,
    canSetImportance:
      actionThreads.every(
        (thread) =>
          (
            props.mailboxContextsByThreadId?.get(thread.threadId)
              ?.mailboxActions ?? props.mailboxActions
          ).canSetImportance
      ) && props.mailboxActions.canSetImportance,
    canSetPlacement:
      actionThreads.every(
        (thread) =>
          (
            props.mailboxContextsByThreadId?.get(thread.threadId)
              ?.mailboxActions ?? props.mailboxActions
          ).canSetPlacement
      ) && props.mailboxActions.canSetPlacement,
    mailboxActions: props.mailboxActions,
    mailboxProvider: actionMailboxProvider,
    runActionThreads,
    sharedPlacement: actionThreads.some(
      (thread) =>
        (
          props.mailboxContextsByThreadId?.get(thread.threadId)
            ?.mailboxActions ?? props.mailboxActions
        ).placementScope === "shared"
    ),
  });

  useHotkeys(
    omitDisabledHotkeys(
      buildMessageListHotkeys({
        actionHotkeysEnabled,
        activeMailbox: props.activeMailbox,
        activeMessageId: props.activeMessageId,
        bulkActions,
        canMarkRead,
        listNavigationHotkeysEnabled,
        mailboxActions: props.mailboxActions,
        mailboxProvider: actionMailboxProvider,
        onDeactivateActiveMessage: props.onDeactivateActiveMessage,
        openAdjacentThread,
        openBulkLabels,
        openFocusedThread,
        runActionThreads,
        selection,
        threadedMessages,
        userLabels,
      })
    ),
    {
      ignoreInputs: true,
    }
  );

  const bulkLabels: MessageListBulkLabels | null =
    labelMailboxId === null ||
    labelMailboxActions === null ||
    actionMailboxProvider === "api" ||
    props.activeMailbox === "drafts" ||
    userLabels.length === 0
      ? null
      : {
          isPending: isBulkActionPending,
          mailboxId: labelMailboxId,
          onApply: async (updates) => {
            await labelMailboxActions.updateThreadsLabels(
              updates.map(({ id, ...changes }) => ({
                ...changes,
                threadId: id,
              }))
            );
          },
          onOpenChange: setIsBulkLabelsOpen,
          open: isBulkLabelsOpen,
          targets: selection.selectedThreads.map((thread) => ({
            id: thread.threadId,
            labelIds: thread.threadLabelIds,
          })),
        };

  useMessageListCommands({
    actions: bulkActions,
    canEditLabels: bulkLabels !== null,
    canFocusSearch,
    focusedSubject: selection.focusedThread?.subject ?? "",
    hasActiveMessage,
    hasFocusedThread: selection.focusedThread !== null,
    hasNextConversation:
      activeThreadIndex !== -1 &&
      activeThreadIndex < threadedMessages.length - 1,
    hasPreviousConversation: activeThreadIndex > 0,
    isPending: isBulkActionPending,
    isSelecting,
    loadedCount: threadedMessages.length,
    onClearSelection: selection.clearSelection,
    onFocusSearch,
    onOpenFocusedThread: openFocusedThread,
    onOpenLabels: openBulkLabels,
    onOpenNextConversation: () => {
      openAdjacentThread(1);
    },
    onOpenPreviousConversation: () => {
      openAdjacentThread(-1);
    },
    onSelectAll: () => {
      selection.toggleAllLoadedThreads(true);
    },
    onToggleFocusedSelection: selection.toggleFocusedThreadSelection,
    scopeKey: JSON.stringify([
      props.mailboxId,
      props.selectionScopeKey,
      props.activeMailbox,
      props.activeMessageId ?? null,
      props.searchQuery,
      selection.focusedThread?.threadId,
      actionThreads.map((thread) => thread.threadId).toSorted(),
    ]),
    selectedCount: selection.selectedThreads.length,
    supportsSelection: actionMailboxProvider !== "api",
  });
  return {
    bulkActions,
    bulkLabels,
    handleClearSelection: selection.clearSelection,
    handleScrollListToTop: selection.scrollListToTop,
    handleToggleAllLoadedThreads: selection.toggleAllLoadedThreads,
    isBulkActionPending,
  };
};

export const MessageList = (props: MessageListProps) => {
  const reducedMotion = useReducedMotion();
  const mailboxSources = new Map<string, MessageListProps["mailboxProvider"]>();
  if (props.mailboxContextsByThreadId) {
    for (const context of props.mailboxContextsByThreadId.values()) {
      mailboxSources.set(context.mailboxId, context.mailboxProvider);
    }
  } else {
    mailboxSources.set(props.mailboxId, props.mailboxProvider);
  }
  const sourceEntries = [...mailboxSources];
  const labelQueries = useQueries({
    queries: sourceEntries.map(([mailboxId, mailboxProvider]) =>
      labelsQueryOptions(mailboxId, mailboxProvider !== "api")
    ),
  });
  const labelsByMailboxId = new Map(
    sourceEntries.map(([mailboxId], index) => [
      mailboxId,
      labelQueries[index]?.data ?? [],
    ])
  );
  const gmailLabels = labelsByMailboxId.get(props.mailboxId) ?? [];
  const flattenedMessages = props.messages.flatMap((page) => page.messages);
  const threadedMessages =
    props.activeMailbox === "drafts"
      ? flattenedMessages.map((message) =>
          buildDraftListEntry(
            message,
            props.mailboxContextsByThreadId !== undefined
          )
        )
      : buildThreadListEntries(flattenedMessages);
  const activeThreadId =
    props.activeMailbox === "drafts" ||
    (props.activeMessageId?.trim() ?? "") === ""
      ? null
      : (flattenedMessages.find(
          (message) => message.id === props.activeMessageId
        )?.threadId ?? null);
  const selection = useMessageListSelection({
    activeMailbox: props.activeMailbox,
    activeThreadId,
    mailboxId: props.mailboxId,
    onActivateMessage: props.onActivateMessage,
    onDeactivateActiveMessage: props.onDeactivateActiveMessage,
    searchQuery: props.searchQuery,
    selectionScopeKey: props.selectionScopeKey,
    threadedMessages,
  });
  const actionThreads = getActionThreads(
    selection.selectedThreads,
    selection.focusedThread
  );
  const actionContexts = actionThreads.map((thread) =>
    props.mailboxContextsByThreadId?.get(thread.threadId)
  );
  let actionMailboxProvider = props.mailboxProvider;
  if (props.mailboxContextsByThreadId) {
    if (
      actionContexts.some(
        (context) => !context || context.mailboxProvider === "api"
      )
    ) {
      actionMailboxProvider = "api";
    } else if (
      actionContexts.some((context) => context?.mailboxProvider === "managed")
    ) {
      actionMailboxProvider = "managed";
    } else {
      actionMailboxProvider = "gmail";
    }
  }
  const singleSourceContext =
    props.mailboxContextsByThreadId &&
    actionContexts.length > 0 &&
    actionContexts.every(
      (context) =>
        context !== undefined &&
        context.mailboxId === actionContexts[0]?.mailboxId
    )
      ? actionContexts[0]
      : undefined;
  const labelMailboxId = props.mailboxContextsByThreadId
    ? (singleSourceContext?.mailboxId ?? null)
    : props.mailboxId;
  const labelMailboxActions = props.mailboxContextsByThreadId
    ? (singleSourceContext?.mailboxActions ?? null)
    : props.mailboxActions;
  const userLabels = (labelsByMailboxId.get(labelMailboxId ?? "") ?? []).filter(
    (label) => label.type === "user"
  );
  const listContainerRef = useRef<HTMLDivElement>(null);
  const focusSearchRef = useRef<(() => void) | null>(null);
  const subscribeToListVisibility = useCallback((onChange: () => void) => {
    const container = listContainerRef.current;
    if (typeof ResizeObserver === "undefined" || container === null) {
      return () => {
        // ResizeObserver is unavailable outside browser layouts.
      };
    }
    const observer = new ResizeObserver(onChange);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);
  const isListVisible = useSyncExternalStore(
    subscribeToListVisibility,
    () => (listContainerRef.current?.getClientRects().length ?? 0) > 0,
    () => false
  );
  const isSelecting =
    selection.selectedThreadIds.size > 0 && actionMailboxProvider !== "api";
  const {
    bulkActions,
    bulkLabels,
    handleClearSelection,
    handleScrollListToTop,
    handleToggleAllLoadedThreads,
    isBulkActionPending,
  } = useMessageListInteractions({
    actionMailboxProvider,
    activeThreadId,
    canFocusSearch: isListVisible,
    isSelecting,
    labelMailboxActions,
    labelMailboxId,
    onFocusSearch: () => {
      focusSearchRef.current?.();
    },
    props,
    selection,
    threadedMessages,
    userLabels,
  });

  const scrollPaneKey =
    props.selectionScopeKey ??
    `${props.mailboxId}:${props.activeMailbox}:${props.searchQuery}`;

  return (
    <div
      className="@container flex min-h-0 flex-1 flex-col"
      ref={listContainerRef}
    >
      <MessageListHeader
        onOpenSidebar={props.onOpenSidebar}
        search={
          <MessageListSearch
            focusSearchRef={focusSearchRef}
            isRefreshing={props.isRefreshing}
            mailboxId={props.mailboxId}
            mailboxProvider={props.mailboxProvider}
            onRefresh={props.onRefresh}
            onScrollToTop={handleScrollListToTop}
            onSearch={props.onSearch}
            searchQuery={props.searchQuery}
            searchMailboxes={props.searchMailboxes}
          />
        }
        selection={
          isSelecting ? (
            <MessageListSelectionToolbar
              actions={bulkActions}
              allSelected={selection.allSelected}
              disabled={props.isPending || isBulkActionPending}
              indeterminate={selection.selectionIndeterminate}
              itemLabelPlural={
                props.activeMailbox === "drafts" ? "drafts" : "conversations"
              }
              labels={bulkLabels}
              onClearSelection={handleClearSelection}
              onToggleAll={handleToggleAllLoadedThreads}
              pending={isBulkActionPending}
              selectedCount={selection.selectedThreadIds.size}
            />
          ) : null
        }
      />

      {props.headerAddon !== undefined && props.headerAddon !== null && (
        <div className="px-2 pb-2 empty:hidden @sm:px-4">
          {props.headerAddon}
        </div>
      )}
      {props.listNotices !== undefined && props.listNotices !== null && (
        <div className="px-2 pb-2 empty:hidden @sm:px-4">
          {props.listNotices}
        </div>
      )}

      <m.div
        animate={{
          filter: "blur(0px)",
          opacity: 1,
          transform: "translate3d(0, 0, 0)",
        }}
        className="flex min-h-0 flex-1 flex-col"
        initial={
          reducedMotion === true
            ? { opacity: 0 }
            : {
                filter: "blur(4px)",
                opacity: 0.55,
                transform: "translate3d(0, 4px, 0)",
              }
        }
        key={scrollPaneKey}
        transition={{
          duration:
            reducedMotion === true
              ? appMotionDuration.feedback
              : appMotionDuration.layout,
          ease: appEaseOut,
        }}
      >
        <MessageListScrollPane
          gmailLabels={gmailLabels}
          gmailLabelsByMailboxId={labelsByMailboxId}
          list={props}
          onKeyboardOpenMessage={props.onKeyboardOpenMessage}
          selection={selection}
          threadedMessages={threadedMessages}
        />
      </m.div>
    </div>
  );
};
