"use client";

import {
  ArrowUp01Icon,
  Loading03Icon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, TextField, TextFieldInput } from "@quietr/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
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
  searchQuery: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSearch: (query: string) => void;
};

const SCROLL_TOP_EPSILON_PX = 2;
const SCROLL_WAIT_TIMEOUT_MS = 600;
const MESSAGE_ROW_HEIGHT_PX = 72;
const MESSAGE_ROW_GAP_PX = 4;
const MESSAGE_LIST_OVERSCAN = 12;

type MessageListSearchProps = {
  isRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
  onScrollToTop: () => void | Promise<void>;
  onSearch: (query: string) => void;
  searchQuery: string;
};

const MessageListSearch = ({
  isRefreshing,
  onRefresh,
  onScrollToTop,
  onSearch,
  searchQuery,
}: MessageListSearchProps) => {
  const draftSearchQueryRef = useRef(searchQuery);

  const applySearch = () => {
    void onScrollToTop();
    onSearch(draftSearchQueryRef.current);
  };

  return (
    <div className="border-b border-border bg-background-light px-4 py-3" role="search">
      <div className="flex items-center gap-2">
        <Button
          disabled={isRefreshing}
          onClick={() => void onRefresh()}
          size="icon-sm"
          variant="outline"
        >
          <SpinWhileActive active={isRefreshing}>
            <HugeiconsIcon icon={Refresh01Icon} />
          </SpinWhileActive>
        </Button>

        <div className="relative min-w-0 flex-1">
          <TextField className="min-w-0">
            <TextFieldInput
              autoCapitalize="off"
              autoCorrect="off"
              className="pr-10"
              defaultValue={searchQuery}
              name="query"
              onChange={(event) => {
                draftSearchQueryRef.current = event.target.value;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applySearch();
                }
              }}
              placeholder="Search"
              size="sm"
              spellCheck={false}
              type="search"
            />
          </TextField>

          <Button
            aria-label="Search"
            className="absolute top-1 right-1 bottom-1 size-6 text-muted-foreground hover:text-foreground"
            onClick={applySearch}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={Search01Icon} />
          </Button>
        </div>

        <Button onClick={() => void onScrollToTop()} size="icon-sm" type="button" variant="outline">
          <HugeiconsIcon icon={ArrowUp01Icon} />
        </Button>
      </div>
    </div>
  );
};

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
  onSearch,
  onActivateMessage,
  onDeletePermanently,
  onLoadMore,
  onMarkAsRead,
  onMarkAsUnread,
  onMoveToTrash,
  onRefresh,
  onUpdateLabels,
  searchQuery,
}: MessageListProps) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollToTopRef = useRef(false);

  const flattenedMessages = useMemo(() => messages.flatMap((page) => page.messages), [messages]);
  const threadedMessages = useMemo(
    () => buildThreadListEntries(flattenedMessages),
    [flattenedMessages],
  );
  const threadedMessageIds = useMemo(
    () => threadedMessages.map((thread) => thread.threadId),
    [threadedMessages],
  );
  const messageThreadIds = useMemo(
    () => new Map(flattenedMessages.map((message) => [message.id, message.threadId] as const)),
    [flattenedMessages],
  );
  const activeThreadId = activeMessageId ? (messageThreadIds.get(activeMessageId) ?? null) : null;

  const messageVirtualizer = useVirtualizer({
    count: threadedMessages.length,
    estimateSize: () => MESSAGE_ROW_HEIGHT_PX,
    gap: MESSAGE_ROW_GAP_PX,
    getItemKey: (index) => threadedMessageIds[index] ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: MESSAGE_LIST_OVERSCAN,
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
      <MessageListSearch
        isRefreshing={isRefreshing}
        key={searchQuery}
        onRefresh={onRefresh}
        onScrollToTop={scrollListToTop}
        onSearch={onSearch}
        searchQuery={searchQuery}
      />

      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 [contain:strict]"
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
                  className="absolute top-0 left-0 w-full"
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
          <p className="px-2 py-8 text-sm text-muted-foreground">
            {searchQuery ? "No messages found." : "No messages."}
          </p>
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
