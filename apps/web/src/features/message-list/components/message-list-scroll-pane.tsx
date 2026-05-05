"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useMemo } from "react";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { getErrorMessage } from "~/lib/errors";
import type { MessageListProps } from "./message-list-types";
import type { useMessageListSelection } from "./use-message-list-selection";
import { MessageRow } from "./message-row";

const MESSAGE_ROW_HEIGHT_PX = 68;
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

type MessageListScrollPaneProps = {
  list: MessageListProps;
  selection: ReturnType<typeof useMessageListSelection>;
  threadedMessages: ThreadListEntry[];
};

const MessageListLoadingSkeleton = () => (
  <div className="space-y-0.5" role="status">
    <span className="sr-only">Loading messages...</span>
    {MESSAGE_LIST_SKELETON_ROW_IDS.map((rowId) => (
      <div
        aria-hidden="true"
        className="flex h-[68px] animate-pulse items-center gap-3 rounded-xl px-3"
        key={rowId}
      >
        <div className="size-[38px] shrink-0 rounded-lg bg-muted/80" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div className="h-3 w-32 rounded-md bg-muted/80" />
            <div className="h-3 w-12 rounded-md bg-muted/70" />
          </div>
          <div className="h-3 w-3/4 rounded-md bg-muted/70" />
        </div>
      </div>
    ))}
  </div>
);

export const MessageListScrollPane = ({
  list,
  selection,
  threadedMessages,
}: MessageListScrollPaneProps) => {
  const flattenedMessages = useMemo(
    () => list.messages.flatMap((page) => page.messages),
    [list.messages],
  );
  const activeThreadId =
    flattenedMessages.find((message) => message.id === list.activeMessageId)?.threadId ?? null;
  const isLoadingEmptyMessages =
    threadedMessages.length === 0 && (list.isPending || list.isRefreshing);

  const messageVirtualizer = useVirtualizer({
    count: threadedMessages.length,
    estimateSize: () => MESSAGE_ROW_HEIGHT_PX,
    gap: MESSAGE_ROW_GAP_PX,
    getItemKey: (index) => threadedMessages[index].threadId ?? index,
    getScrollElement: () => selection.scrollRef.current,
    overscan: MESSAGE_LIST_OVERSCAN,
  });

  const shouldPrefetch = (element: HTMLDivElement) => {
    const distanceToBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    const threshold = Math.max(element.clientHeight, 400);
    return distanceToBottom <= threshold;
  };

  const maybeLoadMore = () => {
    if (
      !selection.scrollRef.current ||
      !shouldPrefetch(selection.scrollRef.current) ||
      !list.hasNextPage ||
      list.isFetchingNextPage ||
      list.isPending ||
      list.isError
    )
      return;

    list.onLoadMore();
  };

  useLayoutEffect(() => {
    maybeLoadMore();
  }, [threadedMessages.length]);

  return (
    <div
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-1.5 pb-3 contain-strict"
      onScroll={() => {
        if (selection.isProgrammaticScrollToTopRef.current) return;
        maybeLoadMore();
      }}
      ref={selection.scrollRef}
    >
      {isLoadingEmptyMessages && <MessageListLoadingSkeleton />}

      {list.isError && (
        <p className="px-2 py-8 text-sm text-destructive">
          {getErrorMessage(list.error, "Could not load messages.")}
        </p>
      )}

      {!list.isError && threadedMessages.length > 0 && (
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
                  className="absolute top-0 left-0 w-full"
                  dataIndex={virtualItem.index}
                  isActive={activeThreadId === thread.threadId}
                  isSelected={selection.selectedThreadIds.has(thread.threadId)}
                  isSelectionMode={selection.selectedThreadIds.size > 0}
                  key={thread.threadId}
                  list={list}
                  selection={selection}
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  thread={thread}
                />
              )
            );
          })}
        </ul>
      )}

      {!isLoadingEmptyMessages && !list.isError && threadedMessages.length === 0 && (
        <p className="px-2 py-8 text-sm text-muted-foreground">
          {list.activeMailbox === "drafts"
            ? list.searchQuery
              ? "No drafts found."
              : "No drafts."
            : list.searchQuery
              ? "No messages found."
              : "No messages."}
        </p>
      )}

      {!list.isError && threadedMessages.length > 0 && (
        <p className="px-2 py-5 text-center text-xs text-muted-foreground">
          {list.isFetchingNextPage || list.hasNextPage ? (
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
