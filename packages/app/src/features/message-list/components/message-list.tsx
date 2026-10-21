"use client";

import {
  Archive02Icon,
  Delete01Icon,
  Delete02Icon,
  InboxIcon,
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
import { useLayoutEffect, useRef, useState } from "react";

const buildDraftListEntry = (
  message: MessageListItem,
  useScopedThreadId: boolean
): ThreadListEntry => ({
  anchorMessage: message,
  attachmentCount:
    message.threadAttachmentCount ?? message.attachments?.length ?? 0,
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
  archive: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} archived.`,
  deleteDrafts: (threads: ThreadListEntry[]) =>
    `${threads.length} ${threads.length === 1 ? "draft" : "drafts"} deleted.`,
  markRead: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} marked as Read.`,
  markSpam: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} marked as Spam.`,
  markUnread: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} marked as Unread.`,
  moveToInbox: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} moved to Inbox.`,
  moveToTrash: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} moved to Trash.`,
  unmarkSpam: (threads: ThreadListEntry[]) =>
    `${formatConversationCount(threads.length)} removed from Spam.`,
} as const;

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
        threadActionSuccessMessage.archive
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
    options: { enabled: context.actionHotkeysEnabled },
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
  runActionThreads,
}: {
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

  if (activeMailbox === "inbox" || activeMailbox === "unread") {
    actions.push({
      icon: Archive02Icon,
      id: "archive-threads",
      label: "Archive",
      onSelect: async () => {
        await runActionThreads(
          mailboxActions.archiveThreads,
          threadActionSuccessMessage.archive
        );
      },
      promoted: true,
    });
  }

  if (activeMailbox === "archive") {
    actions.push({
      icon: InboxIcon,
      id: "move-threads-inbox",
      label: "Move to Inbox",
      onSelect: async () => {
        await runActionThreads(
          mailboxActions.untrashThreads,
          threadActionSuccessMessage.moveToInbox
        );
      },
      promoted: true,
    });
  }

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
  labelMailboxActions,
  labelMailboxId,
  props,
  selection,
  threadedMessages,
  userLabels,
}: {
  actionMailboxProvider: MessageListProps["mailboxProvider"];
  labelMailboxActions: MessageListProps["mailboxActions"] | null;
  labelMailboxId: string | null;
  props: MessageListProps;
  selection: MessageListSelection;
  threadedMessages: ThreadListEntry[];
  userLabels: { type: string }[];
}) => {
  const [isBulkLabelsOpen, setIsBulkLabelsOpen] = useState(false);
  const isBulkActionPending = selection.selectedThreads.some((thread) => {
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
  const openFocusedThread = () => {
    const thread = selection.focusedThread;
    const context =
      thread === null
        ? undefined
        : props.mailboxContextsByThreadId?.get(thread.threadId);
    const isPending =
      thread !== null &&
      ((context?.pendingActions ?? props.pendingActions).isMessageActionPending(
        thread.anchorMessage.id
      ) ||
        (context?.pendingActions ?? props.pendingActions).isThreadActionPending(
          thread.threadId
        ));
    if (
      thread !== null &&
      selection.selectedThreadIds.size === 0 &&
      thread.unreadCount > 0 &&
      (context?.mailboxProvider ?? props.mailboxProvider) !== "api" &&
      !isPending
    ) {
      void (async () => {
        try {
          await (
            context?.mailboxActions ?? props.mailboxActions
          ).markThreadAsRead(thread.threadId);
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
    actionMailboxProvider !== "api" &&
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
        mailboxProvider: actionMailboxProvider,
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

  return {
    bulkActions: buildMessageListBulkActions({
      activeMailbox: props.activeMailbox,
      mailboxActions: props.mailboxActions,
      mailboxProvider: actionMailboxProvider,
      runActionThreads,
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
  const {
    bulkActions,
    bulkLabels,
    handleClearSelection,
    handleScrollListToTop,
    handleToggleAllLoadedThreads,
    isBulkActionPending,
  } = useMessageListInteractions({
    actionMailboxProvider,
    labelMailboxActions,
    labelMailboxId,
    props,
    selection,
    threadedMessages,
    userLabels,
  });

  const isSelecting =
    selection.selectedThreadIds.size > 0 && actionMailboxProvider !== "api";
  const scrollPaneKey =
    props.selectionScopeKey ??
    `${props.mailboxId}:${props.activeMailbox}:${props.searchQuery}`;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <MessageListHeader
        onOpenSidebar={props.onOpenSidebar}
        search={
          <MessageListSearch
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
        <div className="px-2 pb-2 @sm:px-4">{props.headerAddon}</div>
      )}
      {props.listNotices !== undefined && props.listNotices !== null && (
        <div className="px-2 pb-2 @sm:px-4">{props.listNotices}</div>
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
