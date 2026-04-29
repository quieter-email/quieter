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

export const MessageList = ({
  activeMailbox,
  activeMessageId,
  mailboxId,
  error,
  hasNextPage,
  isError,
  isFetchingNextPage,
  isPending,
  isRefreshing,
  mailboxActions,
  messages,
  onActivateMessage,
  onLoadMore,
  onOpenDraft,
  onRefresh,
  onSearch,
  pendingActions,
  searchQuery,
}: MessageListProps) => {
  const flattenedMessages = messages.flatMap((page) => page.messages);
  const threadedMessages =
    activeMailbox === "drafts"
      ? flattenedMessages.map((message) => buildDraftListEntry(message))
      : buildThreadListEntries(flattenedMessages);
  const messageThreadIds = new Map(
    flattenedMessages.map((message) => {
      return [message.id, message.threadId] as const;
    }),
  );
  const activeThreadId =
    activeMailbox === "drafts" || !activeMessageId
      ? null
      : (messageThreadIds.get(activeMessageId) ?? null);
  const {
    allSelected,
    clearSelection,
    handleThreadPress,
    handleThreadSelectionPress,
    isProgrammaticScrollToTopRef,
    scrollListToTop,
    scrollRef,
    selectedThreadIds,
    selectedThreads,
    selectionIndeterminate,
    toggleAllLoadedThreads,
  } = useMessageListSelection({
    activeMailbox,
    activeThreadId,
    onActivateMessage,
    searchQuery,
    threadedMessages,
  });
  const isBulkActionPending = selectedThreads.some(
    (thread) =>
      pendingActions.isMessageActionPending(thread.anchorMessage.id) ||
      pendingActions.isThreadActionPending(thread.threadId),
  );

  const runBulkAction = async (
    action: (threads: ThreadListEntry[]) => void | Promise<void>,
    fallbackMessage: string,
  ) => {
    if (selectedThreads.length === 0) return;

    try {
      await action(selectedThreads);
    } catch (error) {
      toast.error(getErrorMessage(error, fallbackMessage));
    }
  };

  const bulkActions: MessageListBulkAction[] =
    activeMailbox === "drafts"
      ? [
          {
            destructive: true,
            icon: Delete02Icon,
            id: "delete-drafts",
            label: "Delete drafts",
            onSelect: async () => {
              await runBulkAction(mailboxActions.deleteDrafts, "Could not delete those drafts.");
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
                mailboxActions.markThreadsAsRead,
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
                mailboxActions.markThreadsAsUnread,
                "Could not mark those conversations as unread.",
              );
            },
          },
          ...(activeMailbox === "inbox"
            ? [
                {
                  destructive: true,
                  icon: Delete02Icon,
                  id: "mark-threads-spam",
                  label: "Mark as Spam",
                  onSelect: async () => {
                    await runBulkAction(
                      mailboxActions.markThreadsAsSpam,
                      "Could not move those conversations to spam.",
                    );
                  },
                } satisfies MessageListBulkAction,
              ]
            : []),
          ...(activeMailbox === "spam"
            ? [
                {
                  icon: Mail01Icon,
                  id: "unmark-threads-spam",
                  label: "Unmark as Spam",
                  onSelect: async () => {
                    await runBulkAction(
                      mailboxActions.unmarkThreadsAsSpam,
                      "Could not remove those conversations from spam.",
                    );
                  },
                } satisfies MessageListBulkAction,
              ]
            : []),
          {
            destructive: true,
            icon: activeMailbox === "trash" ? Delete02Icon : Delete01Icon,
            id: activeMailbox === "trash" ? "delete-threads" : "move-threads-trash",
            label: activeMailbox === "trash" ? "Delete permanently" : "Move to Trash",
            onSelect: async () => {
              await runBulkAction(
                activeMailbox === "trash"
                  ? mailboxActions.deleteThreadsPermanently
                  : mailboxActions.moveThreadsToTrash,
                activeMailbox === "trash"
                  ? "Could not delete those conversations."
                  : "Could not move those conversations to trash.",
              );
            },
          },
        ];

  const scrollPaneKey = `${activeMailbox}:${searchQuery}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selectedThreadIds.size > 0 ? (
        <MessageListSelectionToolbar
          actions={bulkActions}
          allSelected={allSelected}
          disabled={isPending || isBulkActionPending}
          indeterminate={selectionIndeterminate}
          itemLabelPlural={activeMailbox === "drafts" ? "drafts" : "conversations"}
          onClearSelection={clearSelection}
          onToggleAll={toggleAllLoadedThreads}
          selectedCount={selectedThreadIds.size}
        />
      ) : (
        <MessageListSearch
          isRefreshing={isRefreshing}
          mailboxId={mailboxId}
          onRefresh={onRefresh}
          onScrollToTop={scrollListToTop}
          onSearch={onSearch}
          searchQuery={searchQuery}
        />
      )}

      <MessageListScrollPane
        key={scrollPaneKey}
        isProgrammaticScrollToTopRef={isProgrammaticScrollToTopRef}
        selectedThreadIds={selectedThreadIds}
        scrollRef={scrollRef}
        activeMailbox={activeMailbox}
        activeMessageId={activeMessageId}
        error={error}
        hasNextPage={hasNextPage}
        isError={isError}
        isFetchingNextPage={isFetchingNextPage}
        isPending={isPending}
        isRefreshing={isRefreshing}
        mailboxActions={mailboxActions}
        messages={messages}
        onLoadMore={onLoadMore}
        onOpenDraft={onOpenDraft}
        onThreadPress={handleThreadPress}
        onThreadSelectionPress={handleThreadSelectionPress}
        pendingActions={pendingActions}
        searchQuery={searchQuery}
        threadedMessages={threadedMessages}
        mailboxId={mailboxId}
      />
    </div>
  );
};
