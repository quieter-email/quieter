"use client";

import { ArrowUp01Icon, Loading03Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, TextField, TextFieldInput } from "@quietr/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { ListMessagesPageResult, MailboxCategory } from "~/lib/gmail/gmail";
import { buildThreadListEntries } from "~/lib/gmail/thread-list";
import { MessageRow } from "./message-row";
import { SpinWhileActive } from "./spin-while-active";

type MessageListProps = {
  activeMailbox: MailboxCategory;
  activeMessageId?: string | null;
  onActivateMessage: (messageId: string) => void;
  onMarkAsRead: (messageId: string) => void | Promise<void>;
  onMarkAsUnread: (messageId: string) => void | Promise<void>;
  onUpdateLabels: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveToTrash: (messageId: string) => void | Promise<void>;
  onDeletePermanently: (messageId: string) => void | Promise<void>;
  isMessageActionPending?: (messageId: string) => boolean;
  onRefresh: () => void | Promise<void>;
  isRefreshing: boolean;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  messages: ListMessagesPageResult[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
};

const SCROLL_TOP_EPSILON_PX = 2;
const SCROLL_WAIT_TIMEOUT_MS = 600;

export const MessageList = ({
  activeMailbox,
  activeMessageId,
  error,
  hasNextPage,
  isError,
  isFetchingNextPage,
  isMessageActionPending,
  isPending,
  isRefreshing,
  messages,
  onActivateMessage,
  onDeletePermanently,
  onLoadMore,
  onMarkAsRead,
  onMarkAsUnread,
  onMoveToTrash,
  onRefresh,
  onUpdateLabels,
}: MessageListProps) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollToTopRef = useRef(false);

  const flattenedMessages = messages.flatMap((page) => page.messages);
  const threadedMessages = buildThreadListEntries(flattenedMessages);
  const threadedMessageIds = threadedMessages.map((thread) => thread.threadId);
  const activeThreadId = activeMessageId
    ? (flattenedMessages.find((message) => message.id === activeMessageId)?.threadId ?? null)
    : null;

  const messageVirtualizer = useVirtualizer({
    count: threadedMessages.length,
    estimateSize: () => 72,
    gap: 4,
    getItemKey: (index) => threadedMessageIds[index] ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

  const tryLoadMore = () => {
    if (!hasNextPage || isFetchingNextPage || isPending || isError) return;
    onLoadMore();
  };

  const shouldPrefetch = (element: HTMLDivElement) => {
    const distanceToBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    const threshold = Math.max(element.clientHeight, 400);

    return distanceToBottom <= threshold;
  };

  const maybeLoadMore = () => {
    if (!scrollRef.current) return;
    if (!shouldPrefetch(scrollRef.current)) return;
    tryLoadMore();
  };

  useEffect(() => {
    if (threadedMessages.length === 0 || !scrollRef.current) return;
    maybeLoadMore();
  }, [messages]);

  const waitForSmoothScrollTop = async (element: HTMLDivElement) => {
    await new Promise<void>((resolve) => {
      let done = false;

      const cleanup = () => {
        element.removeEventListener("scroll", onScroll);
        element.removeEventListener("scrollend", onScrollEnd as EventListener);
        clearTimeout(timeoutId);
      };

      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };

      const onScroll = () => {
        if (element.scrollTop <= SCROLL_TOP_EPSILON_PX) finish();
      };

      const onScrollEnd = () => finish();
      const timeoutId = setTimeout(finish, SCROLL_WAIT_TIMEOUT_MS);

      element.addEventListener("scroll", onScroll, { passive: true });

      if ("onscrollend" in element) {
        element.addEventListener("scrollend", onScrollEnd as EventListener, { passive: true });
      }

      if (element.scrollTop <= SCROLL_TOP_EPSILON_PX) finish();
    });
  };

  const waitForNextPaint = async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  };

  const scrollListToTop = async () => {
    if (scrollRef.current && scrollRef.current.scrollTop > SCROLL_TOP_EPSILON_PX) {
      isProgrammaticScrollToTopRef.current = true;

      try {
        scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
        await waitForSmoothScrollTop(scrollRef.current);
        await waitForNextPaint();
      } finally {
        isProgrammaticScrollToTopRef.current = false;
      }
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-background-light px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            disabled={isRefreshing}
            onClick={() => void onRefresh()}
            size="icon-sm"
            variant="outline"
          >
            <SpinWhileActive active={isRefreshing}>
              <HugeiconsIcon icon={RefreshIcon} />
            </SpinWhileActive>
          </Button>

          <TextField>
            <TextFieldInput
              size="sm"
              className="grow"
              placeholder="Search mail (coming soon)"
              type="search"
            />
          </TextField>

          <Button onClick={() => void scrollListToTop()} size="icon-sm" variant="outline">
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </Button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
        onScroll={() => {
          if (isProgrammaticScrollToTopRef.current) return;
          maybeLoadMore();
        }}
        ref={scrollRef}
      >
        {isPending && threadedMessages.length === 0 ? (
          <div className="grid place-items-center px-2 py-8">
            <HugeiconsIcon className="animate-spin text-muted-foreground" icon={Loading03Icon} />
          </div>
        ) : null}

        {isError ? <p className="px-2 py-8 text-sm text-destructive">{error?.message}</p> : null}

        {!isError && threadedMessages.length > 0 ? (
          <ul
            className="relative"
            style={{
              height: `${messageVirtualizer.getTotalSize()}px`,
            }}
          >
            {messageVirtualizer.getVirtualItems().map((virtualItem) => {
              const thread = threadedMessages[virtualItem.index];

              return thread ? (
                <MessageRow
                  activeMailbox={activeMailbox}
                  className="absolute top-0 left-0 w-full will-change-transform"
                  dataIndex={virtualItem.index}
                  isActionPending={isMessageActionPending?.(thread.anchorMessage.id)}
                  isActive={activeThreadId === thread.threadId}
                  key={thread.threadId}
                  onActivateMessage={onActivateMessage}
                  onDeletePermanently={onDeletePermanently}
                  onMarkAsRead={onMarkAsRead}
                  onMarkAsUnread={onMarkAsUnread}
                  onMoveToTrash={onMoveToTrash}
                  onUpdateLabels={onUpdateLabels}
                  rowRef={(element) => {
                    if (!element?.isConnected) return;
                    messageVirtualizer.measureElement(element);
                  }}
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  thread={thread}
                />
              ) : null;
            })}
          </ul>
        ) : null}

        {!isPending && !isError && threadedMessages.length === 0 ? (
          <p className="px-2 py-8 text-sm text-muted-foreground">No messages.</p>
        ) : null}

        {!isError && threadedMessages.length > 0 ? (
          <p className="px-2 py-5 text-center text-xs text-muted-foreground">
            {isFetchingNextPage ? (
              <HugeiconsIcon className="animate-spin text-muted-foreground" icon={Loading03Icon} />
            ) : hasNextPage ? (
              <HugeiconsIcon className="animate-spin text-muted-foreground" icon={Loading03Icon} />
            ) : (
              "You're all caught up."
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
};
