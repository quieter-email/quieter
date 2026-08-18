"use client";

import {
  Archive02Icon,
  Delete01Icon,
  Delete02Icon,
  InboxIcon,
  Mail01Icon,
  MailOpen02Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "@quieter/ui/toast";
import { useHotkeys } from "@tanstack/react-hotkeys";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { m, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";

import {
  omitDisabledHotkeys,
  shouldIgnoreAppShortcut,
} from "#/features/hotkeys/domain/hotkey-guards";
import { MessageListSearch } from "#/features/message-search/components/message-list-search";
import { appEaseOut, appMotionDuration } from "#/features/motion/app-motion";
import type { MailboxCategory, MessageListItem } from "#/lib/gmail/gmail";
import { labelsQueryOptions } from "#/lib/gmail/labels-query";
import { buildThreadListEntries } from "#/lib/gmail/thread-list";
import type { ThreadListEntry } from "#/lib/gmail/thread-list";

import { GmailUsefulDetails } from "./gmail-useful-details";
import { MessageListScrollPane } from "./message-list-scroll-pane";
import { MessageListSelectionToolbar } from "./message-list-selection-toolbar";
import type {
  MessageListBulkAction,
  MessageListBulkLabels,
  MessageListProps,
} from "./message-list-types";
import { useMessageListSelection } from "./use-message-list-selection";

const buildDraftListEntry = (message: MessageListItem): ThreadListEntry => ({
  anchorMessage: message,
  attachmentCount:
    message.threadAttachmentCount ?? message.attachments?.length ?? 0,
  messageCount: Math.max(1, message.threadMessageCount ?? 0),
  messages: [message],
  participants: [],
  preview: message.snippet?.trim() ?? "",
  subject: message.subject?.trim() ?? "(No subject)",
  threadId: message.draftId ?? message.id,
  threadLabelIds: message.threadLabelIds ?? message.labelIds ?? [],
  unreadCount: 0,
});

const formatConversationCount = (count: number) =>
  `${count} ${count === 1 ? "conversation" : "conversations"}`;

type MessageListHotkeyContext = {
  actionHotkeysEnabled: boolean;
  activeMailbox: MailboxCategory;
  activeMessageId: string | null | undefined;
  listNavigationHotkeysEnabled: boolean;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxProvider: MessageListProps["mailboxProvider"];
  onDeactivateActiveMessage: MessageListProps["onDeactivateActiveMessage"];
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
      context.selection.focusThreadByOffset(1);
    },
    hotkey: "J",
    options: { enabled: context.listNavigationHotkeysEnabled },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      context.selection.focusThreadByOffset(-1);
    },
    hotkey: "K",
    options: { enabled: context.listNavigationHotkeysEnabled },
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
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      context.openFocusedThread();
    },
    hotkey: "Enter",
    options: { enabled: context.listNavigationHotkeysEnabled },
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
        context.mailboxActions.archiveThreads,
        (threads) => `${formatConversationCount(threads.length)} archived.`
      );
    },
    hotkey: "E",
    options: {
      enabled:
        context.actionHotkeysEnabled &&
        (context.activeMailbox === "inbox" ||
          context.activeMailbox === "unread"),
    },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.runActionThreads(
        context.mailboxActions.moveThreadsToTrash,
        (threads) =>
          `${formatConversationCount(threads.length)} moved to Trash.`
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
        (threads) =>
          `${formatConversationCount(threads.length)} marked as Spam.`
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
        (threads) =>
          `${formatConversationCount(threads.length)} marked as Read.`
      );
    },
    hotkey: "Shift+I",
    options: { enabled: context.actionHotkeysEnabled },
  },
  {
    callback: (event: KeyboardEvent) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      void context.runActionThreads(
        context.mailboxActions.markThreadsAsUnread,
        (threads) =>
          `${formatConversationCount(threads.length)} marked as Unread.`
      );
    },
    hotkey: "Shift+U",
    options: { enabled: context.actionHotkeysEnabled },
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
  runBulkAction,
}: {
  activeMailbox: MailboxCategory;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxProvider: MessageListProps["mailboxProvider"];
  runBulkAction: (
    action: (threads: ThreadListEntry[]) => void | Promise<void>
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
          await runBulkAction(mailboxActions.deleteDrafts);
        },
      },
    ];
  }

  const actions: MessageListBulkAction[] = [];

  if (activeMailbox === "inbox" || activeMailbox === "unread") {
    actions.push({
      icon: Archive02Icon,
      id: "archive-threads",
      label: "Archive",
      onSelect: async () => {
        await runBulkAction(mailboxActions.archiveThreads);
      },
    });
  }

  if (activeMailbox === "archive") {
    actions.push({
      icon: InboxIcon,
      id: "move-threads-inbox",
      label: "Move to Inbox",
      onSelect: async () => {
        await runBulkAction(mailboxActions.untrashThreads);
      },
    });
  }

  actions.push(
    {
      icon: MailOpen02Icon,
      id: "mark-threads-read",
      label: "Mark as Read",
      onSelect: async () => {
        await runBulkAction(mailboxActions.markThreadsAsRead);
      },
    },
    {
      icon: Mail01Icon,
      id: "mark-threads-unread",
      label: "Mark as Unread",
      onSelect: async () => {
        await runBulkAction(mailboxActions.markThreadsAsUnread);
      },
    }
  );

  if (mailboxProvider === "gmail" && activeMailbox === "inbox") {
    actions.push({
      destructive: true,
      icon: Delete02Icon,
      id: "mark-threads-spam",
      label: "Mark as Spam",
      onSelect: async () => {
        await runBulkAction(mailboxActions.markThreadsAsSpam);
      },
    });
  }

  if (mailboxProvider === "gmail" && activeMailbox === "spam") {
    actions.push({
      icon: Mail01Icon,
      id: "unmark-threads-spam",
      label: "Unmark as Spam",
      onSelect: async () => {
        await runBulkAction(mailboxActions.unmarkThreadsAsSpam);
      },
    });
  }

  if (mailboxProvider === "gmail" && activeMailbox !== "trash") {
    actions.push({
      destructive: true,
      icon: Delete01Icon,
      id: "move-threads-trash",
      label: "Move to Trash",
      onSelect: async () => {
        await runBulkAction(mailboxActions.moveThreadsToTrash);
      },
    });
  }

  return actions;
};

type MessageListSelection = ReturnType<typeof useMessageListSelection>;

const useMessageListInteractions = ({
  props,
  selection,
  threadedMessages,
  userLabels,
}: {
  props: MessageListProps;
  selection: MessageListSelection;
  threadedMessages: ThreadListEntry[];
  userLabels: { type: string }[];
}) => {
  const [isBulkLabelsOpen, setIsBulkLabelsOpen] = useState(false);
  const isBulkActionPending = selection.selectedThreads.some(
    (thread) =>
      props.pendingActions.isMessageActionPending(thread.anchorMessage.id) ||
      props.pendingActions.isThreadActionPending(thread.threadId)
  );

  const runBulkAction = async (
    action: (threads: ThreadListEntry[]) => void | Promise<void>
  ) => {
    if (selection.selectedThreads.length === 0) {
      return;
    }

    try {
      await action(selection.selectedThreads);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not update messages."
      );
    }
  };
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

    try {
      await action(threads);
      toast.success(successMessage(threads));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not update messages."
      );
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
  const openFocusedThread = () => {
    const thread = selection.focusedThread;
    const isPending =
      thread !== null &&
      (props.pendingActions.isMessageActionPending(thread.anchorMessage.id) ||
        props.pendingActions.isThreadActionPending(thread.threadId));
    if (
      thread !== null &&
      selection.selectedThreadIds.size === 0 &&
      thread.unreadCount > 0 &&
      props.mailboxProvider !== "api" &&
      !isPending
    ) {
      void (async () => {
        try {
          await props.mailboxActions.markThreadAsRead(thread.threadId);
        } catch {
          // Ignore mark-read failures during keyboard open.
        }
      })();
    }
    if (props.activeMailbox !== "drafts" && thread !== null) {
      props.onKeyboardOpenMessage?.();
    }
    selection.openFocusedThread();
  };

  const previousActiveMessageIdRef = useRef(props.activeMessageId);

  useLayoutEffect(() => {
    const previousActiveMessageId = previousActiveMessageIdRef.current;
    previousActiveMessageIdRef.current = props.activeMessageId;

    const { keyboardFocusedThreadId } = selection;

    if (
      (previousActiveMessageId?.trim() ?? "") === "" ||
      (props.activeMessageId?.trim() ?? "") !== "" ||
      keyboardFocusedThreadId === null ||
      keyboardFocusedThreadId.trim() === ""
    ) {
      return () => {
        // Focus restore is not needed for this navigation path.
      };
    }

    const focusedThreadId = keyboardFocusedThreadId;
    const showFocusRing = selection.consumeFocusRingRequest();

    const frameId = requestAnimationFrame(() => {
      const focusedRowTrigger =
        selection.scrollRef.current?.querySelector<HTMLButtonElement>(
          `li[data-thread-id="${CSS.escape(focusedThreadId)}"] [data-message-row-trigger]`
        );
      focusedRowTrigger?.focus({
        focusVisible: showFocusRing,
        preventScroll: true,
      });
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [props.activeMessageId, selection]);

  const actionHotkeysEnabled =
    props.mailboxProvider !== "api" &&
    (props.activeMessageId?.trim() ?? "") === "" &&
    props.activeMailbox !== "drafts";
  const listNavigationHotkeysEnabled =
    threadedMessages.length > 0 && (props.activeMessageId?.trim() ?? "") === "";

  useHotkeys(
    omitDisabledHotkeys(
      buildMessageListHotkeys({
        actionHotkeysEnabled,
        activeMailbox: props.activeMailbox,
        activeMessageId: props.activeMessageId,
        listNavigationHotkeysEnabled,
        mailboxActions: props.mailboxActions,
        mailboxProvider: props.mailboxProvider,
        onDeactivateActiveMessage: props.onDeactivateActiveMessage,
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
    props.mailboxProvider === "api" ||
    props.activeMailbox === "drafts" ||
    userLabels.length === 0
      ? null
      : {
          isPending: isBulkActionPending,
          mailboxId: props.mailboxId,
          onApply: async (updates) => {
            await props.mailboxActions.updateThreadsLabels(
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

  return {
    bulkActions: buildMessageListBulkActions({
      activeMailbox: props.activeMailbox,
      mailboxActions: props.mailboxActions,
      mailboxProvider: props.mailboxProvider,
      runBulkAction,
    }),
    bulkLabels,
    handleClearSelection: selection.clearSelection,
    handleScrollListToTop: selection.scrollListToTop,
    handleToggleAllLoadedThreads: selection.toggleAllLoadedThreads,
    isBulkActionPending,
  };
};

export const MessageList = (props: MessageListProps) => {
  const reducedMotion = useReducedMotion();
  const { data: gmailLabels = [] } = useQuery(
    labelsQueryOptions(props.mailboxId, props.mailboxProvider !== "api")
  );
  const userLabels = gmailLabels.filter((label) => label.type === "user");
  const flattenedMessages = props.messages.flatMap((page) => page.messages);
  const threadedMessages =
    props.activeMailbox === "drafts"
      ? flattenedMessages.map((message) => buildDraftListEntry(message))
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
    threadedMessages,
  });
  const {
    bulkActions,
    bulkLabels,
    handleClearSelection,
    handleScrollListToTop,
    handleToggleAllLoadedThreads,
    isBulkActionPending,
  } = useMessageListInteractions({
    props,
    selection,
    threadedMessages,
    userLabels,
  });

  const scrollPaneKey = `${props.mailboxId}:${props.activeMailbox}:${props.searchQuery}`;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      {selection.selectedThreadIds.size > 0 &&
      props.mailboxProvider !== "api" ? (
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
      ) : (
        <MessageListSearch
          isRefreshing={props.isRefreshing}
          mailboxId={props.mailboxId}
          mailboxProvider={props.mailboxProvider}
          onOpenSidebar={props.onOpenSidebar}
          onRefresh={props.onRefresh}
          onScrollToTop={handleScrollListToTop}
          onSearch={props.onSearch}
          searchQuery={props.searchQuery}
        />
      )}

      {props.mailboxProvider === "gmail" &&
        props.activeMailbox === "inbox" &&
        !props.searchQuery.trim() && (
          <GmailUsefulDetails
            mailboxId={props.mailboxId}
            onActivateMessage={props.onActivateMessage}
          />
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
          list={props}
          onKeyboardOpenMessage={props.onKeyboardOpenMessage}
          selection={selection}
          threadedMessages={threadedMessages}
        />
      </m.div>
    </div>
  );
};
