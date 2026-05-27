"use client";

import { Delete01Icon, Delete02Icon, Mail01Icon, MailOpen02Icon } from "@hugeicons/core-free-icons";
import { toast } from "@quieter/ui";
import { m } from "motion/react";
import { useMemo } from "react";
import type { MessageListItem } from "~/lib/gmail/gmail";
import { MessageListSearch } from "~/features/message-search/components/message-list-search";
import { buildThreadListEntries, type ThreadListEntry } from "~/lib/gmail/thread-list";
import type { MessageListBulkAction, MessageListProps } from "./message-list-types";
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

export const MessageList = (props: MessageListProps) => {
  const flattenedMessages = useMemo(
    () => props.messages.flatMap((page) => page.messages),
    [props.messages],
  );
  const threadedMessages = useMemo(
    () =>
      props.activeMailbox === "drafts"
        ? flattenedMessages.map((message) => buildDraftListEntry(message))
        : buildThreadListEntries(flattenedMessages),
    [flattenedMessages, props.activeMailbox],
  );
  const activeThreadId = useMemo(() => {
    if (props.activeMailbox === "drafts" || !props.activeMessageId) return null;

    return (
      flattenedMessages.find((message) => message.id === props.activeMessageId)?.threadId ?? null
    );
  }, [flattenedMessages, props.activeMailbox, props.activeMessageId]);
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

  const bulkActions: MessageListBulkAction[] =
    props.activeMailbox === "drafts"
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
          {
            icon: MailOpen02Icon,
            id: "mark-threads-read",
            label: "Mark as Read",
            onSelect: async () => {
              await runBulkAction(props.mailboxActions.markThreadsAsRead);
            },
          },
          {
            icon: Mail01Icon,
            id: "mark-threads-unread",
            label: "Mark as Unread",
            onSelect: async () => {
              await runBulkAction(props.mailboxActions.markThreadsAsUnread);
            },
          },
          ...(props.activeMailbox === "inbox"
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
          ...(props.activeMailbox === "spam"
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
          {
            destructive: true,
            icon: props.activeMailbox === "trash" ? Delete02Icon : Delete01Icon,
            id: props.activeMailbox === "trash" ? "delete-threads" : "move-threads-trash",
            label: props.activeMailbox === "trash" ? "Delete permanently" : "Move to Trash",
            onSelect: async () => {
              await runBulkAction(
                props.activeMailbox === "trash"
                  ? props.mailboxActions.deleteThreadsPermanently
                  : props.mailboxActions.moveThreadsToTrash,
              );
            },
          },
        ];

  const scrollPaneKey = `${props.activeMailbox}:${props.searchQuery}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selection.selectedThreadIds.size > 0 ? (
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
          onOpenSidebar={props.onOpenSidebar}
          onRefresh={props.onRefresh}
          onScrollToTop={selection.scrollListToTop}
          onSearch={props.onSearch}
          searchQuery={props.searchQuery}
        />
      )}

      <m.div className="flex min-h-0 flex-1 flex-col" {...messageListContentMotion}>
        <MessageListScrollPane
          key={scrollPaneKey}
          list={props}
          selection={selection}
          threadedMessages={threadedMessages}
        />
      </m.div>
    </div>
  );
};
