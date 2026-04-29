"use client";

import { Delete01Icon, Delete02Icon, Mail01Icon, MailOpen02Icon } from "@hugeicons/core-free-icons";
import { toast } from "@quieter/ui";
import type { MessageListItem } from "~/lib/gmail/gmail";
import { MessageListSearch } from "~/features/message-search/components/message-list-search";
import { getErrorMessage } from "~/lib/errors";
import { buildThreadListEntries, type ThreadListEntry } from "~/lib/gmail/thread-list";
import type { MessageListBulkAction, MessageListProps } from "./message-list-types";
import { MessageListScrollPane } from "./message-list-scroll-pane";
import { MessageListSelectionToolbar } from "./message-list-selection-toolbar";
import { useMessageListSelection } from "./use-message-list-selection";

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
  const flattenedMessages = props.messages.flatMap((page) => page.messages);
  const threadedMessages =
    props.activeMailbox === "drafts"
      ? flattenedMessages.map((message) => buildDraftListEntry(message))
      : buildThreadListEntries(flattenedMessages);
  const messageThreadIds = new Map(
    flattenedMessages.map((message) => {
      return [message.id, message.threadId] as const;
    }),
  );
  const activeThreadId =
    props.activeMailbox === "drafts" || !props.activeMessageId
      ? null
      : (messageThreadIds.get(props.activeMessageId) ?? null);
  const selection = useMessageListSelection({
    activeMailbox: props.activeMailbox,
    activeThreadId,
    onActivateMessage: props.onActivateMessage,
    searchQuery: props.searchQuery,
    threadedMessages,
  });
  const isBulkActionPending = selection.selectedThreads.some(
    (thread) =>
      props.pendingActions.isMessageActionPending(thread.anchorMessage.id) ||
      props.pendingActions.isThreadActionPending(thread.threadId),
  );

  const runBulkAction = async (
    action: (threads: ThreadListEntry[]) => void | Promise<void>,
    fallbackMessage: string,
  ) => {
    if (selection.selectedThreads.length === 0) return;

    try {
      await action(selection.selectedThreads);
    } catch (error) {
      toast.error(getErrorMessage(error, fallbackMessage));
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
              await runBulkAction(
                props.mailboxActions.deleteDrafts,
                "Could not delete those drafts.",
              );
            },
          },
        ]
      : [
          {
            icon: MailOpen02Icon,
            id: "mark-threads-read",
            label: "Mark as Read",
            onSelect: async () => {
              await runBulkAction(
                props.mailboxActions.markThreadsAsRead,
                "Could not mark those conversations as read.",
              );
            },
          },
          {
            icon: Mail01Icon,
            id: "mark-threads-unread",
            label: "Mark as Unread",
            onSelect: async () => {
              await runBulkAction(
                props.mailboxActions.markThreadsAsUnread,
                "Could not mark those conversations as unread.",
              );
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
                    await runBulkAction(
                      props.mailboxActions.markThreadsAsSpam,
                      "Could not move those conversations to spam.",
                    );
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
                    await runBulkAction(
                      props.mailboxActions.unmarkThreadsAsSpam,
                      "Could not remove those conversations from spam.",
                    );
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
                props.activeMailbox === "trash"
                  ? "Could not delete those conversations."
                  : "Could not move those conversations to trash.",
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
          onRefresh={props.onRefresh}
          onScrollToTop={selection.scrollListToTop}
          onSearch={props.onSearch}
          searchQuery={props.searchQuery}
        />
      )}

      <MessageListScrollPane
        key={scrollPaneKey}
        list={props}
        selection={selection}
        threadedMessages={threadedMessages}
      />
    </div>
  );
};
