"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useLayoutEffect } from "react";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { getErrorMessage } from "~/lib/errors";
import type { MessageListProps, ThreadPressGesture } from "./message-list-types";
import { MessageRow } from "./message-row";

const MESSAGE_ROW_HEIGHT_PX = 72;
const MESSAGE_ROW_GAP_PX = 0;
const MESSAGE_LIST_OVERSCAN = 12;
const MESSAGE_LIST_SKELETON_ROW_IDS = [
  "message-list-skeleton-1",
  "message-list-skeleton-2",
  "message-list-skeleton-3",
  "message-list-skeleton-4",
  "message-list-skeleton-5",
  "message-list-skeleton-6",
  "message-list-skeleton-7",
  "message-list-skeleton-8",
] as const;

type MessageListScrollPaneProps = Pick<
  MessageListProps,
  | "activeMailbox"
  | "activeMessageId"
  | "error"
  | "hasNextPage"
  | "isError"
  | "isFetchingNextPage"
  | "isPending"
  | "isRefreshing"
  | "mailboxId"
  | "mailboxActions"
  | "messages"
  | "onLoadMore"
  | "onOpenDraft"
  | "pendingActions"
  | "searchQuery"
> & {
  isProgrammaticScrollToTopRef: RefObject<boolean>;
  onThreadPress: (thread: ThreadListEntry, gesture: ThreadPressGesture) => void;
  onThreadSelectionPress: (thread: ThreadListEntry, gesture: ThreadPressGesture) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedThreadIds: ReadonlySet<string>;
  threadedMessages: ThreadListEntry[];
};

const MessageListLoadingSkeleton = () => (
  <div className="space-y-1" role="status">
    <span className="sr-only">Loading messages...</span>
    {MESSAGE_LIST_SKELETON_ROW_IDS.map((rowId) => (
      <div
        aria-hidden="true"
        className="flex h-[72px] animate-pulse items-center gap-3.5 rounded-xl px-3.5"
        key={rowId}
      >
        <div className="size-10 shrink-0 rounded-lg bg-muted/80" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center justify-between gap-4">
            <div className="h-3.5 w-32 rounded-md bg-muted/80" />
            <div className="h-3 w-12 rounded-md bg-muted/70" />
          </div>
          <div className="h-3.5 w-3/4 rounded-md bg-muted/70" />
        </div>
      </div>
    ))}
  </div>
);

export const MessageListScrollPane = ({
  isProgrammaticScrollToTopRef,
  scrollRef,
  activeMailbox,
  activeMessageId,
  error,
  hasNextPage,
  isError,
  isFetchingNextPage,
  isPending,
  isRefreshing,
  mailboxActions,
  messages,
  onLoadMore,
  onOpenDraft,
  onThreadPress,
  onThreadSelectionPress,
  pendingActions,
  selectedThreadIds,
  searchQuery,
  threadedMessages,
  mailboxId,
}: MessageListScrollPaneProps) => {
  const flattenedMessages = messages.flatMap((page) => page.messages);
  const activeThreadId =
    flattenedMessages.find((message) => message.id === activeMessageId)?.threadId ?? null;
  const isLoadingEmptyMessages = threadedMessages.length === 0 && (isPending || isRefreshing);

  const messageVirtualizer = useVirtualizer({
    count: threadedMessages.length,
    estimateSize: () => MESSAGE_ROW_HEIGHT_PX,
    gap: MESSAGE_ROW_GAP_PX,
    getItemKey: (index) => threadedMessages[index].threadId ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: MESSAGE_LIST_OVERSCAN,
  });

  const shouldPrefetch = (element: HTMLDivElement) => {
    const distanceToBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    const threshold = Math.max(element.clientHeight, 400);
    return distanceToBottom <= threshold;
  };

  const maybeLoadMore = () => {
    if (
      !scrollRef.current ||
      !shouldPrefetch(scrollRef.current) ||
      !hasNextPage ||
      isFetchingNextPage ||
      isPending ||
      isError
    )
      return;

    onLoadMore();
  };

  useLayoutEffect(() => {
    maybeLoadMore();
  }, [threadedMessages.length]);

  return (
    <div
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-2 pb-4 contain-strict"
      onScroll={() => {
        if (isProgrammaticScrollToTopRef.current) return;
        maybeLoadMore();
      }}
      ref={scrollRef}
    >
      {isLoadingEmptyMessages && <MessageListLoadingSkeleton />}

      {isError && (
        <p className="px-2 py-8 text-sm text-destructive">
          {getErrorMessage(error, "Could not load messages.")}
        </p>
      )}

      {!isError && threadedMessages.length > 0 && (
        <ul
          className="relative"
          style={{
            height: `${messageVirtualizer.getTotalSize()}px`,
          }}
        >
          {messageVirtualizer.getVirtualItems().map((virtualItem) => {
            const thread = threadedMessages[virtualItem.index];

            return (
              thread && (
                <MessageRow
                  activeMailbox={activeMailbox}
                  className="absolute top-0 left-0 w-full"
                  dataIndex={virtualItem.index}
                  isActionPending={
                    pendingActions.isMessageActionPending(thread.anchorMessage.id) ||
                    pendingActions.isThreadActionPending(thread.threadId)
                  }
                  isActive={activeThreadId === thread.threadId}
                  isSelected={selectedThreadIds.has(thread.threadId)}
                  isSelectionMode={selectedThreadIds.size > 0}
                  key={thread.threadId}
                  onDeleteDraft={mailboxActions.deleteDraft}
                  onDeleteThreadPermanently={mailboxActions.deleteThreadPermanently}
                  onMarkThreadAsRead={mailboxActions.markThreadAsRead}
                  onMarkThreadAsSpam={mailboxActions.markThreadAsSpam}
                  onMarkThreadAsUnread={mailboxActions.markThreadAsUnread}
                  onMoveThreadToTrash={mailboxActions.moveThreadToTrash}
                  onOpenDraft={onOpenDraft}
                  onPress={onThreadPress}
                  onSelectionPress={onThreadSelectionPress}
                  onUntrashThread={mailboxActions.untrashThread}
                  onUnsubscribe={mailboxActions.unsubscribeFromMessage}
                  onUnmarkThreadAsSpam={mailboxActions.unmarkThreadAsSpam}
                  onUpdateThreadLabels={mailboxActions.updateThreadLabels}
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  thread={thread}
                  mailboxId={mailboxId}
                />
              )
            );
          })}
        </ul>
      )}

      {!isLoadingEmptyMessages && !isError && threadedMessages.length === 0 && (
        <p className="px-2 py-8 text-sm text-muted-foreground">
          {activeMailbox === "drafts"
            ? searchQuery
              ? "No drafts found."
              : "No drafts."
            : searchQuery
              ? "No messages found."
              : "No messages."}
        </p>
      )}

      {!isError && threadedMessages.length > 0 && (
        <p className="px-2 py-5 text-center text-xs text-muted-foreground">
          {isFetchingNextPage || hasNextPage ? (
            <HugeiconsIcon
              className="mx-auto animate-spin text-muted-foreground"
              icon={Loading03Icon}
            />
          ) : (
            "You're all caught up."
          )}
        </p>
      )}
    </div>
  );
};
