import { Button } from "@quietr/ui";
import { IconArrowUp, IconLoader, IconRefresh } from "@tabler/icons-solidjs";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, createEffect, createMemo } from "solid-js";
import type { ListMessagesPageResult } from "~/lib/gmail/gmail";
import { MessageRow } from "./message-row";
import { SpinWhileActive } from "./spin-while-active";

type MessageListProps = {
  onActivateMessage: (messageId: string) => void;
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

export const MessageList = (props: MessageListProps) => {
  let scrollRef: HTMLDivElement | null = null;
  const SCROLL_TOP_EPSILON_PX = 2;
  const SCROLL_WAIT_TIMEOUT_MS = 600;
  let isProgrammaticScrollToTop = false;

  const flattenedMessages = createMemo(() => props.messages.flatMap((page) => page.messages));
  const flattenedMessageIds = createMemo(() => flattenedMessages().map((message) => message.id));

  const areMessageIdsEqual = (
    previousMessageIds: readonly string[] | undefined,
    nextMessageIds: readonly string[],
  ) => {
    if (!previousMessageIds || previousMessageIds.length !== nextMessageIds.length) {
      return false;
    }

    for (let index = 0; index < nextMessageIds.length; index += 1) {
      if (previousMessageIds[index] !== nextMessageIds[index]) {
        return false;
      }
    }

    return true;
  };

  const messageVirtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get count() {
      return flattenedMessages().length;
    },
    getScrollElement: () => scrollRef,
    estimateSize: () => 64,
    overscan: 8,
    gap: 8,
    get getItemKey() {
      const messageIds = flattenedMessageIds();
      return (index: number) => messageIds[index] ?? index;
    },
  });

  createEffect((previousMessageIds: readonly string[] | undefined) => {
    const nextMessageIds = flattenedMessageIds();

    if (!areMessageIdsEqual(previousMessageIds, nextMessageIds)) {
      messageVirtualizer.measure();
    }

    return nextMessageIds;
  });

  const tryLoadMore = () => {
    if (!props.hasNextPage || props.isFetchingNextPage || props.isPending || props.isError) return;
    props.onLoadMore();
  };

  const shouldPrefetch = (element: HTMLDivElement) => {
    const distanceToBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    const threshold = Math.max(element.clientHeight, 400);

    return distanceToBottom <= threshold;
  };

  const maybeLoadMore = () => {
    if (!scrollRef) return;
    if (!shouldPrefetch(scrollRef)) return;
    tryLoadMore();
  };

  createEffect(() => {
    const messageCount = flattenedMessages().length;
    if (messageCount === 0 || !scrollRef) return;

    maybeLoadMore();
  });

  const waitForSmoothScrollTop = async (element: HTMLDivElement): Promise<void> => {
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

      const onScrollEnd = () => {
        finish();
      };

      const timeoutId = setTimeout(finish, SCROLL_WAIT_TIMEOUT_MS);

      element.addEventListener("scroll", onScroll, { passive: true });

      if ("onscrollend" in element) {
        element.addEventListener("scrollend", onScrollEnd as EventListener, { passive: true });
      }

      if (element.scrollTop <= SCROLL_TOP_EPSILON_PX) {
        finish();
      }
    });
  };

  const waitForNextPaint = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  };

  const scrollListToTop = async () => {
    const element = scrollRef;

    if (element && element.scrollTop > SCROLL_TOP_EPSILON_PX) {
      isProgrammaticScrollToTop = true;

      try {
        element.scrollTo({ top: 0, behavior: "smooth" });
        await waitForSmoothScrollTop(element);
        await waitForNextPaint();
      } finally {
        isProgrammaticScrollToTop = false;
      }
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="border-b border-border/70 px-3 py-3 sm:px-4">
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={props.isRefreshing}
            onClick={() => void props.onRefresh()}
          >
            <SpinWhileActive active={props.isRefreshing}>
              <IconRefresh />
            </SpinWhileActive>
          </Button>

          <input
            type="search"
            placeholder="Search mail (coming soon)"
            class="h-8 min-w-0 flex-1 border border-input bg-background px-3 text-xs text-foreground shadow-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search mail (coming soon)"
          />

          <Button variant="outline" size="icon-sm" onClick={() => void scrollListToTop()}>
            <IconArrowUp />
          </Button>
        </div>
      </div>

      <div
        ref={(el) => {
          scrollRef = el;
        }}
        class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4"
        onScroll={() => {
          if (isProgrammaticScrollToTop) return;
          maybeLoadMore();
        }}
      >
        <Show when={props.isPending && flattenedMessages().length === 0} fallback={null}>
          <div class="px-2 py-6">
            <IconLoader class="animate-spin text-muted-foreground" />
          </div>
        </Show>

        <Show when={props.isError} fallback={null}>
          <p class="px-2 py-6 text-sm text-destructive">{props.error?.message}</p>
        </Show>

        <Show when={!props.isError && flattenedMessages().length > 0} fallback={null}>
          <ul
            class="relative"
            style={{
              height: `${messageVirtualizer.getTotalSize()}px`,
            }}
          >
            <For each={messageVirtualizer.getVirtualItems()}>
              {(virtualItem) => {
                const message = () => flattenedMessages()[virtualItem.index];

                return (
                  <Show when={message()} keyed>
                    {(resolvedMessage) => (
                      <MessageRow
                        message={resolvedMessage}
                        onActivateMessage={props.onActivateMessage}
                        class="absolute top-0 left-0 w-full will-change-transform"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      />
                    )}
                  </Show>
                );
              }}
            </For>
          </ul>
        </Show>

        <Show
          when={!props.isPending && !props.isError && flattenedMessages().length === 0}
          fallback={null}
        >
          <p class="px-2 py-6 text-sm text-muted-foreground">No messages.</p>
        </Show>

        <Show when={!props.isError && flattenedMessages().length > 0} fallback={null}>
          <p class="px-2 py-4 text-xs text-muted-foreground">
            {props.isFetchingNextPage ? (
              <IconLoader class="animate-spin text-muted-foreground" />
            ) : props.hasNextPage ? (
              <IconLoader class="animate-spin text-muted-foreground" />
            ) : (
              "You're all caught up."
            )}
          </p>
        </Show>
      </div>
    </div>
  );
};
