"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { getAggregateDeliveryStatusFromStatuses } from "@quieter/app/features/message-delivery/domain/delivery-status";
import { getMessageListDeliveryOptions } from "@quieter/app/features/message-delivery/domain/message-delivery-query";
import { supportsMessageDelivery } from "@quieter/app/features/message-delivery/domain/message-delivery-support";
import type { MessageListProps } from "@quieter/app/features/message-list/components/message-list-types";
import { MessageRow } from "@quieter/app/features/message-list/components/message-row";
import type { useMessageListSelection } from "@quieter/app/features/message-list/components/use-message-list-selection";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import {
  getThreadQueryKey,
  getThreadWithDetailsOptions,
} from "@quieter/app/lib/mail/thread-query";
import { verificationCodesQueryOptions } from "@quieter/app/lib/mail/verification-codes-query";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import type { RouterOutputs } from "@quieter/orpc";
import { Icon } from "@quieter/ui/icon";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

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
  gmailLabelsByMailboxId?: ReadonlyMap<string, MailboxLabel[]>;
  list: MessageListProps;
  onKeyboardOpenMessage?: () => void;
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

  const distanceToBottom =
    element.scrollHeight - (element.scrollTop + element.clientHeight);
  if (distanceToBottom <= Math.max(element.clientHeight, 400)) {
    onLoadMore();
  }
};

const MessageListLoadingSkeleton = () => (
  <div aria-live="polite" className="block space-y-0.5">
    <span className="sr-only">Loading messages…</span>
    {MESSAGE_LIST_SKELETON_ROW_IDS.map((rowId) => (
      <div
        aria-hidden="true"
        className="flex h-17 animate-pulse items-center gap-2 rounded-xl px-2 @sm:gap-3 @sm:px-3"
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

const useThreadIntentPrefetch = (
  mailboxId: string,
  mailboxContextsByThreadId: MessageListProps["mailboxContextsByThreadId"],
  queryClient: ReturnType<typeof useQueryClient>
) => {
  const intentTimerRef = useRef<number | null>(null);
  const intentThreadIdRef = useRef<string | null>(null);
  const handleThreadIntent = (threadId: string | null) => {
    if (intentTimerRef.current !== null) {
      window.clearTimeout(intentTimerRef.current);
      intentTimerRef.current = null;
    }
    intentThreadIdRef.current = threadId;
    if (threadId === null || threadId === "") {
      return;
    }
    intentTimerRef.current = window.setTimeout(() => {
      intentTimerRef.current = null;
      if (intentThreadIdRef.current !== threadId) {
        return;
      }
      const context = mailboxContextsByThreadId?.get(threadId);
      if (mailboxContextsByThreadId && !context) {
        return;
      }
      const sourceMailboxId = context?.mailboxId ?? mailboxId;
      const originalThreadId = context?.originalThreadId ?? threadId;
      const queryKey = getThreadQueryKey(sourceMailboxId, originalThreadId);
      if (queryClient.isFetching({ exact: true, queryKey }) > 0) {
        return;
      }
      void Promise.allSettled([
        queryClient.query(
          getThreadWithDetailsOptions(sourceMailboxId, originalThreadId)
        ),
      ]);
    }, 200);
  };

  useLayoutEffect(
    () => () => {
      if (intentTimerRef.current !== null) {
        window.clearTimeout(intentTimerRef.current);
      }
    },
    []
  );

  return handleThreadIntent;
};

const getEmptyMessageLabel = (
  activeMailbox: MessageListProps["activeMailbox"],
  searchQuery: string
) => {
  if (activeMailbox === "drafts") {
    return searchQuery ? "No drafts found." : "No drafts.";
  }
  if (searchQuery) {
    return "No messages found.";
  }
  return "No messages.";
};

const isLoadingEmptyMessageList = (
  threadedMessages: readonly ThreadListEntry[],
  isPending: boolean
) => threadedMessages.length === 0 && isPending;

export const MessageListScrollPane = ({
  gmailLabels,
  gmailLabelsByMailboxId,
  list,
  onKeyboardOpenMessage,
  selection,
  threadedMessages,
}: MessageListScrollPaneProps) => {
  const queryClient = useQueryClient();
  const flattenedMessages = list.messages.flatMap((page) => page.messages);
  const activeThreadId =
    flattenedMessages.find((message) => message.id === list.activeMessageId)
      ?.threadId ?? null;
  const isLoadingEmptyMessages = isLoadingEmptyMessageList(
    threadedMessages,
    list.isPending
  );
  const handleThreadIntent = useThreadIntentPrefetch(
    list.mailboxId,
    list.mailboxContextsByThreadId,
    queryClient
  );

  const deliveryBuckets = useMemo(() => {
    const buckets = new Map<
      string,
      { messageIds: string[]; uiIdByOriginalId: Map<string, string> }
    >();
    for (const thread of threadedMessages) {
      const context = list.mailboxContextsByThreadId?.get(thread.threadId);
      if (list.mailboxContextsByThreadId && !context) {
        continue;
      }
      const sourceMailboxId = context?.mailboxId ?? list.mailboxId;
      if (
        !supportsMessageDelivery({
          mailboxId: sourceMailboxId,
          mailboxProvider: context?.mailboxProvider ?? list.mailboxProvider,
          message: thread.anchorMessage,
        })
      ) {
        continue;
      }
      const originalMessageId =
        context?.originalMessageIds.get(thread.anchorMessage.id) ??
        thread.anchorMessage.id;
      const bucket = buckets.get(sourceMailboxId) ?? {
        messageIds: [],
        uiIdByOriginalId: new Map<string, string>(),
      };
      bucket.messageIds.push(originalMessageId);
      bucket.uiIdByOriginalId.set(originalMessageId, thread.anchorMessage.id);
      buckets.set(sourceMailboxId, bucket);
    }
    return [...buckets].map(([mailboxId, bucket]) => ({
      mailboxId,
      ...bucket,
    }));
  }, [
    threadedMessages,
    list.mailboxContextsByThreadId,
    list.mailboxId,
    list.mailboxProvider,
  ]);
  const deliveryQueries = useQueries({
    queries: deliveryBuckets.map((bucket) =>
      getMessageListDeliveryOptions({
        enabled: bucket.messageIds.length > 0,
        mailboxId: bucket.mailboxId,
        messageIds: bucket.messageIds,
      })
    ),
  });
  const deliveryStatusByMessageId = useMemo(() => {
    const statuses = new Map<
      string,
      ReturnType<typeof getAggregateDeliveryStatusFromStatuses>
    >();
    for (const [index, query] of deliveryQueries.entries()) {
      const bucket = deliveryBuckets[index];
      if (bucket === undefined) {
        continue;
      }
      for (const [originalId, messageStatuses] of Object.entries(
        query.data ?? {}
      )) {
        const uiMessageId = bucket.uiIdByOriginalId.get(originalId);
        if (uiMessageId) {
          statuses.set(
            uiMessageId,
            getAggregateDeliveryStatusFromStatuses(messageStatuses)
          );
        }
      }
    }
    return statuses;
  }, [deliveryBuckets, deliveryQueries]);

  // Track when we first see each thread ID to identify new messages
  const seenTimestampsRef = useRef<Map<string, number> | null>(null);
  seenTimestampsRef.current ??= new Map();
  const seenTimestamps = seenTimestampsRef.current;
  const now = Date.now();
  const animationScopeKey = list.selectionScopeKey ?? list.mailboxId;
  const isFirstLoad = seenTimestamps.size === 0;

  for (const thread of threadedMessages) {
    if (thread.threadId) {
      const compositeKey = `${animationScopeKey}-${thread.threadId}`;
      if (!seenTimestamps.has(compositeKey)) {
        seenTimestamps.set(compositeKey, isFirstLoad ? 0 : now);
      }
    }
  }

  // Identify threads that are new (seen in the last 2 seconds)
  const newThreads = threadedMessages.filter((t) => {
    const compositeKey = `${animationScopeKey}-${t.threadId}`;
    return (seenTimestamps.get(compositeKey) ?? 0) > now - 2000;
  });

  const rowHeightEstimateRef = useRef(MESSAGE_ROW_HEIGHT_PX);
  const measuredWidthRef = useRef(0);
  const pendingAnchorRef = useRef<
    (Pick<VirtualItem, "index" | "key"> & { offsetWithinRow: number }) | null
  >(null);
  const previousActiveMessageIdRef = useRef(list.activeMessageId);
  const pendingFocusRef = useRef<{
    threadId: string;
    focusVisible: boolean;
    scrollIntoView: boolean;
  } | null>(null);
  // react-doctor-disable-next-line react-hooks-js/incompatible-library
  const messageVirtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: threadedMessages.length,
    estimateSize: () => rowHeightEstimateRef.current,
    gap: MESSAGE_ROW_GAP_PX,
    getItemKey: (index) => threadedMessages[index].threadId ?? index,
    getScrollElement: () => selection.scrollRef.current,
    measureElement: (element, _entry, instance) => {
      const height = element.offsetHeight;
      const key = instance.options.getItemKey(
        instance.indexFromElement(element)
      );
      return height > 0
        ? height
        : (instance.itemSizeCache.get(key) ?? rowHeightEstimateRef.current);
    },
    overscan: MESSAGE_LIST_OVERSCAN,
  });
  const updateRowMeasurements = useCallback(() => {
    const element = selection.scrollRef.current;
    if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) {
      return false;
    }
    const width = element.clientWidth;
    const rows = element.querySelectorAll<HTMLLIElement>("li[data-index]");
    const firstRow = element.querySelector<HTMLLIElement>("li[data-index]");
    const height = firstRow?.offsetHeight ?? 0;
    if (
      !firstRow &&
      measuredWidthRef.current !== width &&
      !pendingAnchorRef.current
    ) {
      const anchor = messageVirtualizer.getVirtualItemForOffset(
        element.scrollTop
      );
      if (anchor) {
        pendingAnchorRef.current = {
          index: anchor.index,
          key: anchor.key,
          offsetWithinRow:
            element.scrollTop -
            anchor.start -
            Number(getComputedStyle(element).paddingTop.replace("px", "")),
        };
      }
    }
    if (
      height <= 0 ||
      (measuredWidthRef.current === width &&
        rowHeightEstimateRef.current === height)
    ) {
      return false;
    }

    const viewportTop = element.getBoundingClientRect().top;
    let anchorRow = firstRow;
    for (const row of rows) {
      if (row.getBoundingClientRect().top > viewportTop) {
        break;
      }
      anchorRow = row;
    }
    if (anchorRow?.dataset.threadId && !pendingAnchorRef.current) {
      pendingAnchorRef.current = {
        index: Number(anchorRow.dataset.index),
        key: anchorRow.dataset.threadId,
        offsetWithinRow: viewportTop - anchorRow.getBoundingClientRect().top,
      };
    }
    measuredWidthRef.current = width;
    rowHeightEstimateRef.current = height;
    messageVirtualizer.measure();
    for (const row of rows) {
      messageVirtualizer.measureElement(row);
    }
    return true;
  }, [messageVirtualizer, selection.scrollRef]);

  useLayoutEffect((): (() => void) | undefined => {
    const element = selection.scrollRef.current;
    if (!element) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      updateRowMeasurements();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [selection.scrollRef, updateRowMeasurements]);

  const virtualItems = messageVirtualizer.getVirtualItems();
  const codeThreadIdBuckets = useMemo(() => {
    if (list.activeMailbox === "drafts") {
      return [];
    }
    const sources = new Map<
      string,
      { threadIds: string[]; uiIdByOriginalId: Map<string, string> }
    >();
    for (const thread of threadedMessages) {
      const context = list.mailboxContextsByThreadId?.get(thread.threadId);
      if (
        (list.mailboxContextsByThreadId && !context) ||
        (context?.mailboxProvider ?? list.mailboxProvider) === "api"
      ) {
        continue;
      }
      const mailboxId = context?.mailboxId ?? list.mailboxId;
      const originalThreadId = context?.originalThreadId ?? thread.threadId;
      const source = sources.get(mailboxId) ?? {
        threadIds: [],
        uiIdByOriginalId: new Map<string, string>(),
      };
      if (!source.uiIdByOriginalId.has(originalThreadId)) {
        source.threadIds.push(originalThreadId);
      }
      source.uiIdByOriginalId.set(originalThreadId, thread.threadId);
      sources.set(mailboxId, source);
    }
    const buckets: {
      mailboxId: string;
      threadIds: string[];
      uiIdByOriginalId: Map<string, string>;
    }[] = [];
    for (const [mailboxId, source] of sources) {
      for (let offset = 0; offset < source.threadIds.length; offset += 100) {
        buckets.push({
          mailboxId,
          threadIds: source.threadIds.slice(offset, offset + 100),
          uiIdByOriginalId: source.uiIdByOriginalId,
        });
      }
    }
    return buckets;
  }, [
    threadedMessages,
    list.activeMailbox,
    list.mailboxContextsByThreadId,
    list.mailboxId,
    list.mailboxProvider,
  ]);
  const codeQueries = useQueries({
    queries: codeThreadIdBuckets.map(({ mailboxId, threadIds }) => ({
      ...verificationCodesQueryOptions(
        mailboxId,
        { mode: "threads", threadIds },
        true
      ),
      placeholderData: () => {
        const requestedThreadIds = new Set(threadIds);
        return {
          items: queryClient
            .getQueriesData<RouterOutputs["mail"]["listVerificationCodes"]>({
              queryKey: ["verification-codes", mailboxId, "threads"],
            })
            .toSorted(
              ([leftKey], [rightKey]) =>
                (queryClient.getQueryState(rightKey)?.dataUpdatedAt ?? 0) -
                (queryClient.getQueryState(leftKey)?.dataUpdatedAt ?? 0)
            )
            .flatMap(([, data]) => data?.items ?? [])
            .filter((item) => requestedThreadIds.has(item.threadId)),
        };
      },
    })),
  });
  const latestCodeByThreadId = new Map<
    string,
    RouterOutputs["mail"]["listVerificationCodes"]["items"][number]
  >();
  for (const [index, query] of codeQueries.entries()) {
    const bucket = codeThreadIdBuckets[index];
    if (bucket === undefined) {
      continue;
    }
    for (const code of query.data?.items ?? []) {
      const uiThreadId = bucket.uiIdByOriginalId.get(code.threadId);
      if (uiThreadId && !latestCodeByThreadId.has(uiThreadId)) {
        latestCodeByThreadId.set(uiThreadId, code);
      }
    }
  }
  const hasMountedPrefetchRef = useRef(false);

  useLayoutEffect((): (() => void) | undefined => {
    if (
      hasMountedPrefetchRef.current ||
      !list.hasNextPage ||
      list.isError ||
      list.isFetchingNextPage ||
      list.isPending
    ) {
      return undefined;
    }

    hasMountedPrefetchRef.current = true;
    loadMoreIfNeeded({
      element: selection.scrollRef.current,
      hasNextPage: list.hasNextPage,
      isError: list.isError,
      isFetchingNextPage: list.isFetchingNextPage,
      isPending: list.isPending,
      onLoadMore: list.onLoadMore,
    });
    return undefined;
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
    const previousActiveMessageId = previousActiveMessageIdRef.current;
    previousActiveMessageIdRef.current = list.activeMessageId;
    const isViewingMessage = (list.activeMessageId?.trim() ?? "") !== "";
    const threadId = selection.keyboardFocusedThreadId;
    const focusVisible = selection.consumeFocusRingRequest();
    const isReturningToList = (previousActiveMessageId?.trim() ?? "") !== "";
    if (isViewingMessage) {
      const returnThreadId = activeThreadId ?? threadId;
      if (returnThreadId) {
        pendingFocusRef.current = {
          focusVisible:
            focusVisible ||
            (pendingFocusRef.current?.threadId === returnThreadId &&
              pendingFocusRef.current.focusVisible),
          scrollIntoView: false,
          threadId: returnThreadId,
        };
      }
    } else if (isReturningToList) {
      const returnThreadId = pendingFocusRef.current?.threadId ?? threadId;
      if (returnThreadId) {
        pendingFocusRef.current = {
          focusVisible:
            focusVisible || pendingFocusRef.current?.focusVisible === true,
          scrollIntoView: false,
          threadId: returnThreadId,
        };
      }
    } else if (focusVisible && threadId) {
      pendingFocusRef.current = {
        focusVisible,
        scrollIntoView: true,
        threadId,
      };
    }

    if (updateRowMeasurements()) {
      return;
    }

    const element = selection.scrollRef.current;
    if (
      !element ||
      element.clientWidth <= 0 ||
      element.clientHeight <= 0 ||
      virtualItems.length === 0
    ) {
      return;
    }
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (anchor && threadedMessages[anchor.index]?.threadId === anchor.key) {
      const offset = messageVirtualizer.getOffsetForIndex(
        anchor.index,
        "start"
      );
      if (offset) {
        messageVirtualizer.scrollToOffset(
          offset[0] +
            Number(getComputedStyle(element).paddingTop.replace("px", "")) +
            Math.min(anchor.offsetWithinRow, rowHeightEstimateRef.current - 1)
        );
      }
    }

    if (isViewingMessage) {
      return;
    }
    const focus = pendingFocusRef.current;
    if (!focus) {
      return;
    }
    const focusedIndex = threadedMessages.findIndex(
      (thread) => thread.threadId === focus.threadId
    );
    if (focusedIndex === -1) {
      pendingFocusRef.current = null;
      return;
    }

    const trigger = element.querySelector<HTMLButtonElement>(
      `li[data-thread-id="${CSS.escape(focus.threadId)}"] [data-message-row-trigger]`
    );
    if (focus.scrollIntoView || !trigger) {
      focus.scrollIntoView = false;
      messageVirtualizer.scrollToIndex(focusedIndex, { align: "auto" });
    }
    if (trigger) {
      pendingFocusRef.current = null;
      trigger.focus({ focusVisible: focus.focusVisible, preventScroll: true });
    }
  });

  const handleThreadFocus = selection.focusThread;
  const handleOpenDraft = list.onOpenDraft;

  const emptyMessageLabel = getEmptyMessageLabel(
    list.activeMailbox,
    list.searchQuery
  );

  return (
    <div
      // oxlint-disable-next-line shadcn/no-arbitrary-values -- Floor the bottom inset at 1rem; max() cannot be a token.
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] contain-strict @sm:px-4"
      onScroll={() => {
        if (selection.isProgrammaticScrollToTopRef.current) {
          return;
        }
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
        <p className="px-2 py-8 text-body text-destructive">
          {list.error instanceof Error
            ? list.error.message
            : "Could not load messages."}
        </p>
      )}

      {!list.isError && threadedMessages.length > 0 && (
        <ul
          className="relative"
          style={{
            // oxlint-disable-next-line shadcn/no-inline-styles -- Height is measured from the virtualizer.
            height: `${messageVirtualizer.getTotalSize()}px`,
          }}
        >
          {virtualItems.map((virtualItem) => {
            const thread = threadedMessages[virtualItem.index];
            const context =
              thread === undefined
                ? undefined
                : list.mailboxContextsByThreadId?.get(thread.threadId);
            const compositeKey = thread?.threadId
              ? `${animationScopeKey}-${thread.threadId}`
              : "";
            const isNew = thread?.threadId
              ? (seenTimestamps.get(compositeKey) ?? 0) > now - 2000
              : false;
            const staggerIndex =
              isNew && thread?.threadId
                ? newThreads.findIndex((t) => t.threadId === thread.threadId)
                : 0;

            if (
              thread === undefined ||
              (list.mailboxContextsByThreadId && !context)
            ) {
              return null;
            }
            return (
              <MessageRow
                activeMailbox={list.activeMailbox}
                badge={context?.badge}
                className="absolute top-0 left-0 w-full"
                dataIndex={virtualItem.index}
                rowRef={messageVirtualizer.measureElement}
                wideCompactRows={list.wideCompactRows}
                deliveryStatus={
                  thread.anchorMessage.id === undefined
                    ? undefined
                    : deliveryStatusByMessageId.get(thread.anchorMessage.id)
                }
                gmailLabels={
                  context
                    ? (gmailLabelsByMailboxId?.get(context.mailboxId) ?? [])
                    : gmailLabels
                }
                isNew={isNew}
                key={thread.threadId}
                mailboxActions={context?.mailboxActions ?? list.mailboxActions}
                mailboxEmailAddress={context?.emailAddress}
                mailboxDisplayName={context?.displayName}
                mailboxId={context?.mailboxId ?? list.mailboxId}
                mailboxProvider={
                  context?.mailboxProvider ?? list.mailboxProvider
                }
                offsetY={virtualItem.start}
                onThreadFocus={handleThreadFocus}
                onThreadIntent={handleThreadIntent}
                onOpenDraft={handleOpenDraft}
                onKeyboardOpen={onKeyboardOpenMessage}
                onThreadPress={selection.handleThreadPress}
                onThreadSelectionPress={selection.handleThreadSelectionPress}
                pendingActions={context?.pendingActions ?? list.pendingActions}
                staggerIndex={staggerIndex}
                state={{
                  active: activeThreadId === thread.threadId,
                  selected: selection.selectedThreadIds.has(thread.threadId),
                  selectionMode: selection.selectedThreadIds.size > 0,
                }}
                thread={thread}
                verificationCode={latestCodeByThreadId.get(thread.threadId)}
              />
            );
          })}
        </ul>
      )}

      {!isLoadingEmptyMessages &&
        !list.isError &&
        threadedMessages.length === 0 && (
          <p className="px-2 py-8 text-body text-muted-fg">
            {emptyMessageLabel}
          </p>
        )}

      {!list.isError && threadedMessages.length > 0 && (
        <p className="px-2 py-5 text-center text-caption text-muted-fg">
          {list.isFetchingNextPage || list.hasNextPage ? (
            <Icon
              animation="spin"
              tone="muted"
              className="mx-auto"
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
