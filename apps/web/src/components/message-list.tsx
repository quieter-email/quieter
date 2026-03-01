import type { JSX } from "solid-js";
import { Button } from "@quietr/ui";
import { IconRefresh } from "@tabler/icons-solidjs";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { motion } from "motion-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { ListMessagesPageResult } from "~/lib/gmail/gmail";
import { MessageRow } from "./message-row";

const SpinWhileActive = (props: { active: boolean; children: JSX.Element }) => {
  const [rotation, setRotation] = createSignal(0);

  createEffect(() => {
    if (props.active) {
      setRotation((prev) => prev + 360);
    }
  });

  const onSpinComplete = () => {
    if (props.active) {
      setRotation((prev) => prev + 360);
    }
  };

  return (
    <motion.span
      class="inline-flex"
      animate={{ rotate: rotation() }}
      transition={{ duration: 1, ease: "easeInOut" }}
      onAnimationComplete={onSpinComplete}
    >
      {props.children}
    </motion.span>
  );
};

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

  const flattenedMessages = createMemo(() => props.messages.flatMap((page) => page.messages));

  const messageVirtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get count() {
      return flattenedMessages().length;
    },
    getScrollElement: () => scrollRef,
    estimateSize: () => 64,
    overscan: 8,
    gap: 8,
    getItemKey: (index) => flattenedMessages()[index]?.id ?? index,
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

  const refreshList = () => {
    scrollRef?.scrollTo({ top: 0, behavior: "auto" });
    void props.onRefresh();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="border-b border-border/70 px-3 py-3 sm:px-4">
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={props.isRefreshing}
            onClick={() => refreshList()}
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
        </div>
      </div>

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
    </div>
  );
};

