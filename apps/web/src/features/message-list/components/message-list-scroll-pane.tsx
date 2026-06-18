"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useRef } from "react";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
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
  gmailLabels: MailboxLabel[];
  list: MessageListProps;
  selection: ReturnType<typeof useMessageListSelection>;
  threadedMessages: ThreadListEntry[];
};

const loadMoreIfNeeded = ({
  element,
  hasNextPage,
  isError,
  isFetchingNextPage,
  isPending,
  onLoadMore,
}: {
  element: HTMLDivElement | null;
  hasNextPage: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  onLoadMore: () => void;
}) => {
  if (!element || !hasNextPage || isFetchingNextPage || isPending || isError) {
    return;
  }

  const distanceToBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
  if (distanceToBottom <= Math.max(element.clientHeight, 400)) {
    onLoadMore();
  }
};

const MessageListLoadingSkeleton = () => (
  // react-doctor-disable-next-line react-doctor/prefer-tag-over-role
  <div aria-live="polite" className="block space-y-0.5" role="status">
    <span className="sr-only">Loading messages…</span>
    {MESSAGE_LIST_SKELETON_ROW_IDS.map((rowId) => (
      <div
        aria-hidden="true"
        className="flex h-17 animate-pulse items-center gap-3 rounded-xl px-3"
        key={rowId}
      >
        <div className="size-9.5 shrink-0 rounded-lg bg-muted/80" />
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
  gmailLabels,
  list,
  selection,
  threadedMessages,
}: MessageListScrollPaneProps) => {
  const flattenedMessages = list.messages.flatMap((page) => page.messages);
  const activeThreadId =
    flattenedMessages.find((message) => message.id === list.activeMessageId)?.threadId ?? null;
  const isLoadingEmptyMessages =
    threadedMessages.length === 0 && (list.isPending || list.isRefreshing);

  // react-doctor-disable-next-line react-hooks-js/incompatible-library
  const messageVirtualizer = useVirtualizer({
    count: threadedMessages.length,
    estimateSize: () => MESSAGE_ROW_HEIGHT_PX,
    gap: MESSAGE_ROW_GAP_PX,
    getItemKey: (index) => threadedMessages[index].threadId ?? index,
    getScrollElement: () => selection.scrollRef.current,
    overscan: MESSAGE_LIST_OVERSCAN,
  });
  const virtualItems = messageVirtualizer.getVirtualItems();
  const visibleMessageIds = virtualItems.flatMap(
    (virtualItem) =>
      threadedMessages[virtualItem.index]?.messages.map((message) => message.id) ?? [],
  );
  const visibleMessageIdsKey = visibleMessageIds.join(":");
  const visibleMessageIdsRef = useRef(visibleMessageIds);
  visibleMessageIdsRef.current = visibleMessageIds;
  const hasMountedPrefetchRef = useRef(false);

  useLayoutEffect(() => {
    if (hasMountedPrefetchRef.current) return;
    hasMountedPrefetchRef.current = true;
    loadMoreIfNeeded({
      element: selection.scrollRef.current,
      hasNextPage: list.hasNextPage,
      isError: list.isError,
      isFetchingNextPage: list.isFetchingNextPage,
      isPending: list.isPending,
      onLoadMore: list.onLoadMore,
    });
  }, [
    list.hasNextPage,
    list.isError,
    list.isFetchingNextPage,
    list.isPending,
    list.onLoadMore,
    selection.scrollRef,
    threadedMessages.length,
  ]);

  useLayoutEffect(() => {
    list.onVisibleMessageIdsChange?.(visibleMessageIdsRef.current);
  }, [list.onVisibleMessageIdsChange, visibleMessageIdsKey]);

  return (
    <div
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-1.5 pb-3 contain-strict"
      onScroll={() => {
        if (selection.isProgrammaticScrollToTopRef.current) return;
        loadMoreIfNeeded({
          element: selection.scrollRef.current,
          hasNextPage: list.hasNextPage,
          isError: list.isError,
          isFetchingNextPage: list.isFetchingNextPage,
          isPending: list.isPending,
          onLoadMore: list.onLoadMore,
        });
      }}
      ref={selection.scrollRef}
    >
      {isLoadingEmptyMessages && <MessageListLoadingSkeleton />}

      {list.isError && (
        <p className="px-2 py-8 text-sm text-destructive">
          {(list.error as { message?: string })?.message ?? "Could not load messages."}
        </p>
      )}

      {!list.isError && threadedMessages.length > 0 && (
        <ul
          className="relative"
          style={{
            height: `${messageVirtualizer.getTotalSize()}px`,
          }}
        >
          {virtualItems.map((virtualItem) => {
            const thread = threadedMessages[virtualItem.index];

            return (
              thread && (
                <MessageRow
                  activeMailbox={list.activeMailbox}
                  className="absolute top-0 left-0 w-full"
                  dataIndex={virtualItem.index}
                  gmailLabels={gmailLabels}
                  isActive={activeThreadId === thread.threadId}
                  isSelected={selection.selectedThreadIds.has(thread.threadId)}
                  isSelectionMode={selection.selectedThreadIds.size > 0}
                  key={thread.threadId}
                  mailboxActions={list.mailboxActions}
                  mailboxId={list.mailboxId}
                  mailboxProvider={list.mailboxProvider}
                  offsetY={virtualItem.start}
                  onOpenDraft={list.onOpenDraft}
                  onThreadPress={selection.handleThreadPress}
                  onThreadSelectionPress={selection.handleThreadSelectionPress}
                  pendingActions={list.pendingActions}
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
