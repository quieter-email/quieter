import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Show, createEffect, createMemo } from "solid-js";
import type { ListMessagesPageResult } from "~/lib/gmail/gmail";
import { MessageRow } from "./message-row";

const PREFETCH_MIN_DISTANCE_PX = 400;
const MESSAGE_ROW_GAP_PX = 8;
const MESSAGE_ROW_ESTIMATE_HEIGHT_PX = 84;
const MESSAGE_LIST_OVERSCAN = 8;

type MessageListProps = {
  onActivateMessage: (messageId: string) => void;
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

  const flattenedMessages = createMemo(() => props.messages.flatMap((page) => page.messages));

  const messageVirtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get count() {
      return flattenedMessages().length;
    },
    getScrollElement: () => scrollRef,
    estimateSize: () => MESSAGE_ROW_ESTIMATE_HEIGHT_PX,
    overscan: MESSAGE_LIST_OVERSCAN,
    gap: MESSAGE_ROW_GAP_PX,
    getItemKey: (index) => flattenedMessages()[index]?.id ?? index,
  });

  const tryLoadMore = () => {
    if (!props.hasNextPage || props.isFetchingNextPage || props.isPending || props.isError) return;
    props.onLoadMore();
  };

  const shouldPrefetch = (element: HTMLDivElement) => {
    const distanceToBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    const threshold = Math.max(element.clientHeight, PREFETCH_MIN_DISTANCE_PX);

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

  return (
    <div
      ref={(el) => {
        scrollRef = el;
      }}
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4"
      onScroll={() => maybeLoadMore()}
    >
      <Show when={props.isPending && flattenedMessages().length === 0} fallback={null}>
        <p class="px-2 py-6 text-sm text-muted-foreground">Loading messages...</p>
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
              const message = flattenedMessages()[virtualItem.index];
              if (!message) return null;

              return (
                <MessageRow
                  message={message}
                  onActivateMessage={props.onActivateMessage}
                  class="absolute top-0 left-0 w-full will-change-transform"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  data-index={virtualItem.index}
                  ref={(element) => {
                    element.dataset.index = `${virtualItem.index}`;
                    messageVirtualizer.measureElement(element);
                  }}
                />
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
          {props.isFetchingNextPage
            ? "Loading more messages..."
            : props.hasNextPage
              ? "Fetching ahead before you reach the end..."
              : "You're all caught up."}
        </p>
      </Show>
    </div>
  );
};
