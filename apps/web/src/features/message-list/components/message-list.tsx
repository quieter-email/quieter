"use client";

import {
  Archive02Icon,
  Delete01Icon,
  Delete02Icon,
  InboxIcon,
  Mail01Icon,
  MailOpen02Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "@quieter/ui/toast";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { m } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { MessageListItem } from "~/lib/gmail/gmail";
import { shouldIgnoreAppShortcut } from "~/features/hotkeys/domain/hotkey-guards";
import { MessageLabelsDialog } from "~/features/message-labels/components/message-labels-dialog";
import { MessageListSearch } from "~/features/message-search/components/message-list-search";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import { buildThreadListEntries, type ThreadListEntry } from "~/lib/gmail/thread-list";
import type { MessageListBulkAction, MessageListProps } from "./message-list-types";
import { GmailUsefulDetails } from "./gmail-useful-details";
import { MessageListScrollPane } from "./message-list-scroll-pane";
import { MessageListSelectionToolbar } from "./message-list-selection-toolbar";
import { useMessageListSelection } from "./use-message-list-selection";

const messageListContentMotion = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  style: { transformOrigin: "center center" },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

const buildDraftListEntry = (message: MessageListItem): ThreadListEntry => ({
  threadId: message.draftId ?? message.id,
  anchorMessage: message,
  messages: [message],
  participants: [],
  subject: message.subject?.trim() || "(No subject)",
  preview: message.snippet?.trim() || "",
  messageCount: Math.max(1, message.threadMessageCount ?? 0),
  attachmentCount: message.threadAttachmentCount ?? message.attachments?.length ?? 0,
  unreadCount: 0,
});

const formatConversationCount = (count: number) =>
  `${count} ${count === 1 ? "conversation" : "conversations"}`;

export const MessageList = (props: MessageListProps) => {
  const [isBulkLabelsOpen, setIsBulkLabelsOpen] = useState(false);
  const { data: gmailLabels = [] } = useQuery(
    labelsQueryOptions(props.mailboxId, props.mailboxProvider !== "api"),
  );
  const userLabels = gmailLabels.filter((label) => label.type === "user");
  const labelNounPlural = "labels";
  const flattenedMessages = props.messages.flatMap((page) => page.messages);
  const threadedMessages =
    props.activeMailbox === "drafts"
      ? flattenedMessages.map((message) => buildDraftListEntry(message))
      : buildThreadListEntries(flattenedMessages);
  const activeThreadId =
    props.activeMailbox === "drafts" || !props.activeMessageId
      ? null
      : (flattenedMessages.find((message) => message.id === props.activeMessageId)?.threadId ??
        null);
  const selection = useMessageListSelection({
    activeMailbox: props.activeMailbox,
    activeThreadId,
    mailboxId: props.mailboxId,
    onActivateMessage: props.onActivateMessage,
    onDeactivateActiveMessage: props.onDeactivateActiveMessage,
    searchQuery: props.searchQuery,
    threadedMessages,
  });
  const isBulkActionPending = selection.selectedThreads.some(
    (thread) =>
      props.pendingActions.isMessageActionPending(thread.anchorMessage.id) ||
      props.pendingActions.isThreadActionPending(thread.threadId),
  );

  const runBulkAction = async (action: (threads: ThreadListEntry[]) => void | Promise<void>) => {
    if (selection.selectedThreads.length === 0) return;

    try {
      await action(selection.selectedThreads);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Could not update messages.",
      );
    }
  };
  const getActionThreads = () =>
    selection.selectedThreads.length > 0
      ? selection.selectedThreads
      : selection.focusedThread
        ? [selection.focusedThread]
        : [];
  const runActionThreads = async (
    action: (threads: ThreadListEntry[]) => void | Promise<void>,
    successMessage: (threads: ThreadListEntry[]) => string,
  ) => {
    const threads = getActionThreads();
    if (threads.length === 0) return;

    try {
      await action(threads);
      toast.success(successMessage(threads));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Could not update messages.",
      );
    }
  };
  const openBulkLabels = () => {
    if (userLabels.length === 0) return;

    if (selection.selectedThreads.length === 0 && selection.focusedThread) {
      selection.selectSingleThread(selection.focusedThread.threadId);
    }

    setIsBulkLabelsOpen(true);
  };
  const bulkActions: MessageListBulkAction[] =
    props.mailboxProvider === "api"
      ? []
      : props.activeMailbox === "drafts"
        ? [
            {
              destructive: true,
              icon: Delete02Icon,
              id: "delete-drafts",
              label: "Delete drafts",
              onSelect: async () => {
                await runBulkAction(props.mailboxActions.deleteDrafts);
              },
            },
          ]
        : [
            ...(props.activeMailbox === "inbox" || props.activeMailbox === "unread"
              ? [
                  {
                    icon: Archive02Icon,
                    id: "archive-threads",
                    label: "Archive",
                    onSelect: async () => {
                      await runBulkAction(props.mailboxActions.archiveThreads);
                    },
                  } satisfies MessageListBulkAction,
                ]
              : []),
            ...(props.activeMailbox === "archive"
              ? [
                  {
                    icon: InboxIcon,
                    id: "move-threads-inbox",
                    label: "Move to Inbox",
                    onSelect: async () => {
                      await runBulkAction(props.mailboxActions.untrashThreads);
                    },
                  } satisfies MessageListBulkAction,
                ]
              : []),
            {
              icon: MailOpen02Icon,
              id: "mark-threads-read",
              label: "Mark as Read",
              onSelect: async () => {
                await runBulkAction(props.mailboxActions.markThreadsAsRead);
              },
            },
            ...(userLabels.length > 0
              ? [
                  {
                    icon: Tag01Icon,
                    id: "modify-thread-labels",
                    label: `Modify ${labelNounPlural}`,
                    onSelect: openBulkLabels,
                  } satisfies MessageListBulkAction,
                ]
              : []),
            {
              icon: Mail01Icon,
              id: "mark-threads-unread",
              label: "Mark as Unread",
              onSelect: async () => {
                await runBulkAction(props.mailboxActions.markThreadsAsUnread);
              },
            },
            ...(props.mailboxProvider === "gmail" && props.activeMailbox === "inbox"
              ? [
                  {
                    destructive: true,
                    icon: Delete02Icon,
                    id: "mark-threads-spam",
                    label: "Mark as Spam",
                    onSelect: async () => {
                      await runBulkAction(props.mailboxActions.markThreadsAsSpam);
                    },
                  } satisfies MessageListBulkAction,
                ]
              : []),
            ...(props.mailboxProvider === "gmail" && props.activeMailbox === "spam"
              ? [
                  {
                    icon: Mail01Icon,
                    id: "unmark-threads-spam",
                    label: "Unmark as Spam",
                    onSelect: async () => {
                      await runBulkAction(props.mailboxActions.unmarkThreadsAsSpam);
                    },
                  } satisfies MessageListBulkAction,
                ]
              : []),
            ...(props.mailboxProvider !== "gmail" || props.activeMailbox === "trash"
              ? []
              : [
                  {
                    destructive: true,
                    icon: Delete01Icon,
                    id: "move-threads-trash",
                    label: "Move to Trash",
                    onSelect: async () => {
                      await runBulkAction(props.mailboxActions.moveThreadsToTrash);
                    },
                  } satisfies MessageListBulkAction,
                ]),
          ];

  const scrollPaneKey = `${props.mailboxId}:${props.activeMailbox}:${props.searchQuery}`;
  const actionHotkeysEnabled =
    props.mailboxProvider !== "api" && !props.activeMessageId && props.activeMailbox !== "drafts";
  const previousActiveMessageIdRef = useRef(props.activeMessageId);

  useLayoutEffect(() => {
    const previousActiveMessageId = previousActiveMessageIdRef.current;
    previousActiveMessageIdRef.current = props.activeMessageId;

    const keyboardFocusedThreadId = selection.keyboardFocusedThreadId;

    if (!previousActiveMessageId || props.activeMessageId || !keyboardFocusedThreadId) {
      return;
    }

    const showFocusRing = selection.consumeFocusRingRequest();

    const frameId = requestAnimationFrame(() => {
      const focusedRowTrigger = selection.scrollRef.current?.querySelector<HTMLButtonElement>(
        `li[data-thread-id="${CSS.escape(keyboardFocusedThreadId)}"] [data-message-row-trigger]`,
      );
      focusedRowTrigger?.focus({ preventScroll: true, focusVisible: showFocusRing });

      if (!showFocusRing) {
        focusedRowTrigger
          ?.closest<HTMLElement>("[data-message-row]")
          ?.removeAttribute("data-focus-visible");
        return;
      }

      requestAnimationFrame(() => {
        const row = focusedRowTrigger?.closest<HTMLElement>("[data-message-row]");
        if (focusedRowTrigger?.matches(":focus-visible")) {
          row?.setAttribute("data-focus-visible", "");
        } else {
          row?.removeAttribute("data-focus-visible");
        }
      });
    });

    return () => cancelAnimationFrame(frameId);
  }, [
    props.activeMessageId,
    selection.consumeFocusRingRequest,
    selection.keyboardFocusedThreadId,
    selection.scrollRef,
  ]);

  useHotkeys(
    [
      {
        hotkey: "J",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          selection.focusThreadByOffset(1);
        },
        options: { enabled: threadedMessages.length > 0 },
      },
      {
        hotkey: "K",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          selection.focusThreadByOffset(-1);
        },
        options: { enabled: threadedMessages.length > 0 },
      },
      {
        hotkey: "O",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          selection.openFocusedThread();
        },
        options: { enabled: threadedMessages.length > 0 },
      },
      {
        hotkey: "Enter",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          selection.openFocusedThread();
        },
        options: { enabled: threadedMessages.length > 0 },
      },
      {
        hotkey: "X",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          selection.toggleFocusedThreadSelection();
        },
        options: { enabled: threadedMessages.length > 0 },
      },
      {
        hotkey: "U",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          if (props.activeMessageId) {
            selection.requestFocusRing();
            props.onDeactivateActiveMessage();
            return;
          }
          selection.clearSelection();
        },
        options: { enabled: threadedMessages.length > 0 || !!props.activeMessageId },
      },
      {
        hotkey: "E",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runActionThreads(
            props.mailboxActions.archiveThreads,
            (threads) => `${formatConversationCount(threads.length)} archived.`,
          );
        },
        options: {
          enabled:
            actionHotkeysEnabled &&
            (props.activeMailbox === "inbox" || props.activeMailbox === "unread"),
        },
      },
      {
        hotkey: "Shift+3",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runActionThreads(
            props.mailboxActions.moveThreadsToTrash,
            (threads) => `${formatConversationCount(threads.length)} moved to Trash.`,
          );
        },
        options: {
          enabled:
            actionHotkeysEnabled &&
            props.mailboxProvider === "gmail" &&
            props.activeMailbox !== "trash",
        },
      },
      {
        hotkey: "Shift+1",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runActionThreads(
            props.mailboxActions.markThreadsAsSpam,
            (threads) => `${formatConversationCount(threads.length)} marked as Spam.`,
          );
        },
        options: {
          enabled:
            actionHotkeysEnabled &&
            props.mailboxProvider === "gmail" &&
            props.activeMailbox === "inbox",
        },
      },
      {
        hotkey: "Shift+I",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runActionThreads(
            props.mailboxActions.markThreadsAsRead,
            (threads) => `${formatConversationCount(threads.length)} marked as Read.`,
          );
        },
        options: { enabled: actionHotkeysEnabled },
      },
      {
        hotkey: "Shift+U",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runActionThreads(
            props.mailboxActions.markThreadsAsUnread,
            (threads) => `${formatConversationCount(threads.length)} marked as Unread.`,
          );
        },
        options: { enabled: actionHotkeysEnabled },
      },
      {
        hotkey: "L",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          openBulkLabels();
        },
        options: { enabled: actionHotkeysEnabled && userLabels.length > 0 },
      },
    ],
    {
      ignoreInputs: true,
    },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selection.selectedThreadIds.size > 0 && props.mailboxProvider !== "api" ? (
        <MessageListSelectionToolbar
          actions={bulkActions}
          allSelected={selection.allSelected}
          disabled={props.isPending || isBulkActionPending}
          indeterminate={selection.selectionIndeterminate}
          itemLabelPlural={props.activeMailbox === "drafts" ? "drafts" : "conversations"}
          onClearSelection={selection.clearSelection}
          onToggleAll={selection.toggleAllLoadedThreads}
          selectedCount={selection.selectedThreadIds.size}
        />
      ) : (
        <MessageListSearch
          isRefreshing={props.isRefreshing}
          mailboxId={props.mailboxId}
          mailboxProvider={props.mailboxProvider}
          onOpenSidebar={props.onOpenSidebar}
          onRefresh={props.onRefresh}
          onScrollToTop={selection.scrollListToTop}
          onSearch={props.onSearch}
          searchQuery={props.searchQuery}
        />
      )}

      {props.mailboxProvider === "gmail" &&
        props.activeMailbox === "inbox" &&
        !props.searchQuery && (
          <GmailUsefulDetails
            mailboxId={props.mailboxId}
            onActivateMessage={props.onActivateMessage}
          />
        )}

      <m.div className="flex min-h-0 flex-1 flex-col" {...messageListContentMotion}>
        <MessageListScrollPane
          gmailLabels={gmailLabels}
          key={scrollPaneKey}
          list={props}
          selection={selection}
          threadedMessages={threadedMessages}
        />
      </m.div>

      <MessageLabelsDialog
        isPending={isBulkActionPending}
        mailboxId={props.mailboxId}
        onApply={(updates) =>
          props.mailboxActions.updateThreadsLabels(
            updates.map(({ id, ...changes }) => ({ ...changes, threadId: id })),
          )
        }
        onOpenChange={setIsBulkLabelsOpen}
        open={isBulkLabelsOpen}
        targets={selection.selectedThreads.map((thread) => ({
          id: thread.threadId,
          labelIds: thread.anchorMessage.labelIds ?? [],
        }))}
      />
    </div>
  );
};
