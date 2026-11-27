"use client";

import { getAggregateDeliveryStatusFromStatuses } from "@quieter/app/features/message-delivery/domain/delivery-status";
import { getMessageListDeliveryOptions } from "@quieter/app/features/message-delivery/domain/message-delivery-query";
import { supportsMessageDelivery } from "@quieter/app/features/message-delivery/domain/message-delivery-support";
import type { MessageListProps } from "@quieter/app/features/message-list/components/message-list-types";
import { MessageRow } from "@quieter/app/features/message-list/components/message-row";
import type { useMessageListSelection } from "@quieter/app/features/message-list/components/use-message-list-selection";
import { useThreadVerificationCodes } from "@quieter/app/features/verification-codes/use-thread-verification-codes";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import { MAILBOX_LABELS } from "@quieter/app/lib/mail";
import {
  attachThreadPreloader,
  THREAD_PRELOAD_LIMIT,
} from "@quieter/app/lib/mail-cache-lifecycle";
import type { ThreadPreloadCandidate } from "@quieter/app/lib/mail-cache-lifecycle";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { mailListRowParts } from "@quieter/ui/mail-list-row";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  measureElement as measureVirtualElement,
  useVirtualizer,
} from "@tanstack/react-virtual";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MESSAGE_ROW_HEIGHT_PX = 60;
const SELECTION_TRAY_CLEARANCE_PX = 72;
const MESSAGE_LIST_OVERSCAN = 12;
const MESSAGE_LIST_PREFETCH_VIEWPORTS = 2;

type MessageListScrollPaneProps = {
  gmailLabels: MailboxLabel[];
  gmailLabelsByMailboxId?: ReadonlyMap<string, MailboxLabel[]>;
  list: MessageListProps;
  onKeyboardOpenMessage?: () => void;
  onThreadSnooze: (thread: ThreadListEntry) => void;
  selection: ReturnType<typeof useMessageListSelection>;
  showSelectionTray: boolean;
  threadedMessages: ThreadListEntry[];
};

type MessageListScrollAnchor = Pick<VirtualItem, "index" | "key"> & {
  offsetWithinRow: number;
};

const getScrollAnchor = (
  element: HTMLDivElement,
  virtualizer: Virtualizer<HTMLDivElement, HTMLLIElement>,
  scrollOffset = element.scrollTop
): MessageListScrollAnchor | null => {
  const paddingTop = Number(
    getComputedStyle(element).paddingTop.replace("px", "")
  );
  const offset = scrollOffset - paddingTop;
  const anchor = virtualizer.getVirtualItemForOffset(offset);
  return anchor && anchor.start <= offset
    ? {
        index: anchor.index,
        key: anchor.key,
        offsetWithinRow: offset - anchor.start,
      }
    : null;
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
  if (
    !element ||
    element.clientHeight <= 0 ||
    !hasNextPage ||
    isFetchingNextPage ||
    isPending ||
    isError
  ) {
    return;
  }

  const distanceToBottom =
    element.scrollHeight - (element.scrollTop + element.clientHeight);
  if (
    distanceToBottom <=
    Math.max(element.clientHeight * MESSAGE_LIST_PREFETCH_VIEWPORTS, 400)
  ) {
    onLoadMore();
  }
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
  onThreadSnooze,
  selection,
  showSelectionTray,
  threadedMessages,
}: MessageListScrollPaneProps) => {
  const { onFilterByLabel: handleFilterByLabel } = list;
  const queryClient = useQueryClient();
  const flattenedMessages = list.messages.flatMap((page) => page.messages);
  const activeThreadId =
    flattenedMessages.find((message) => message.id === list.activeMessageId)
      ?.threadId ?? null;
  const isLoadingEmptyMessages = isLoadingEmptyMessageList(
    threadedMessages,
    list.isPending
  );
  const preloaderRef = useRef<ReturnType<typeof attachThreadPreloader> | null>(
    null
  );
  useLayoutEffect(() => {
    const preloader = attachThreadPreloader(queryClient);
    preloaderRef.current = preloader;
    return () => {
      preloader?.dispose();
      preloaderRef.current = null;
    };
  }, [
    queryClient,
    list.selectionScopeKey,
    list.mailboxId,
    list.activeMailbox,
    list.searchQuery,
  ]);
  const candidateForThread = (
    thread: ThreadListEntry
  ): ThreadPreloadCandidate | undefined => {
    const context = list.mailboxContextsByThreadId?.get(thread.threadId);
    if (list.mailboxContextsByThreadId && !context) {
      return undefined;
    }
    const mailboxId = context?.mailboxId ?? list.mailboxId;
    const message = thread.anchorMessage;
    return {
      expectedMessage: {
        id: context?.originalMessageIds.get(message.id) ?? message.id,
        includeDrafts:
          ((context?.mailboxProvider ?? list.mailboxProvider) !== "gmail" &&
            !isSandboxMailboxId(mailboxId)) ||
          (message.draftId?.trim() ?? "") !== "" ||
          message.labelIds?.includes(MAILBOX_LABELS.drafts) === true,
        threadMessageCount: message.threadMessageCount,
      },
      mailboxId,
      threadId: context?.originalThreadId ?? thread.threadId,
    };
  };
  const handleThreadIntent = (threadId: string | null) => {
    const thread = threadedMessages.find(
      (entry) => entry.threadId === threadId
    );
    preloaderRef.current?.intent(
      thread ? (candidateForThread(thread) ?? null) : null
    );
  };

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

  const leadingRowsRef = useRef<HTMLDivElement>(null);
  const [leadingRowsHeight, setLeadingRowsHeight] = useState(0);
  const hasLeadingRows =
    list.leadingRows !== undefined && list.leadingRows !== null;
  useLayoutEffect((): (() => void) | undefined => {
    const element = leadingRowsRef.current;
    if (!element) {
      setLeadingRowsHeight(0);
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      setLeadingRowsHeight(element.offsetHeight);
    });
    observer.observe(element);
    setLeadingRowsHeight(element.offsetHeight);
    return () => {
      observer.disconnect();
    };
  }, [hasLeadingRows]);
  const rowHeightEstimateRef = useRef(MESSAGE_ROW_HEIGHT_PX);
  const measuredWidthRef = useRef(0);
  const pendingLayoutRef = useRef<{ animation: Animation | null } | null>(null);
  const pendingAnchorRef = useRef<MessageListScrollAnchor | null>(null);
  const lastScrollAnchorRef = useRef<MessageListScrollAnchor | null>(null);
  const threadOrderKey = useMemo(
    () => threadedMessages.map((thread) => thread.threadId).join("\u0000"),
    [threadedMessages]
  );
  const previousLayoutRef = useRef<{
    leadingRowsHeight: number;
    threadOrderKey: string;
  } | null>(null);
  const previousActiveMessageIdRef = useRef(list.activeMessageId);
  const lastFocusedRowRef = useRef<{
    index: number;
    threadId: string;
  } | null>(null);
  useLayoutEffect(() => {
    lastFocusedRowRef.current = null;
  }, [
    list.selectionScopeKey,
    list.mailboxId,
    list.activeMailbox,
    list.searchQuery,
  ]);
  const pendingFocusRef = useRef<{
    threadId: string;
    focusVisible: boolean;
    scrollIntoView: boolean;
  } | null>(null);
  // react-doctor-disable-next-line react-hooks-js/incompatible-library
  const messageVirtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: threadedMessages.length,
    estimateSize: () => rowHeightEstimateRef.current,
    gap: 1,
    getItemKey: (index) => threadedMessages[index].threadId ?? index,
    getScrollElement: () => selection.scrollRef.current,
    measureElement: (element, entry, instance) => {
      const index = instance.indexFromElement(element);
      const key = instance.options.getItemKey(index);
      const cachedHeight = instance.itemSizeCache.get(key);
      const previousHeight =
        cachedHeight ??
        instance.measurementsCache[index]?.size ??
        rowHeightEstimateRef.current;
      const height = measureVirtualElement(element, entry, instance);
      const viewport = selection.scrollRef.current;
      if (
        height > 0 &&
        height !== previousHeight &&
        !pendingAnchorRef.current &&
        viewport &&
        measuredWidthRef.current > 0
      ) {
        const width = viewport.clientWidth;
        if (width > 0 && width !== measuredWidthRef.current) {
          pendingAnchorRef.current = getScrollAnchor(viewport, instance);
        }
      }
      return height > 0
        ? height
        : (cachedHeight ?? rowHeightEstimateRef.current);
    },
    overscan: MESSAGE_LIST_OVERSCAN,
    scrollMargin: leadingRowsHeight,
    scrollPaddingEnd: showSelectionTray ? SELECTION_TRAY_CLEARANCE_PX : 0,
  });
  useLayoutEffect(() => {
    const element = selection.scrollRef.current;
    const previousLayout = previousLayoutRef.current;
    previousLayoutRef.current = { leadingRowsHeight, threadOrderKey };
    if (
      !element ||
      previousLayout === null ||
      element.scrollTop <= 1 ||
      pendingAnchorRef.current
    ) {
      return;
    }
    const leadingRowsResized =
      previousLayout.leadingRowsHeight !== leadingRowsHeight;
    if (
      previousLayout.threadOrderKey === threadOrderKey &&
      !leadingRowsResized
    ) {
      return;
    }
    const anchor = lastScrollAnchorRef.current;
    if (!anchor) {
      return;
    }
    const nextIndex = threadedMessages.findIndex(
      (thread) => thread.threadId === anchor.key
    );
    if (nextIndex === -1) {
      lastScrollAnchorRef.current = getScrollAnchor(
        element,
        messageVirtualizer
      );
      return;
    }
    if (nextIndex === anchor.index && !leadingRowsResized) {
      return;
    }
    const offset = messageVirtualizer.getOffsetForIndex(nextIndex, "start");
    if (!offset) {
      return;
    }
    const nextTop =
      offset[0] +
      Number(getComputedStyle(element).paddingTop.replace("px", "")) +
      Math.min(anchor.offsetWithinRow, rowHeightEstimateRef.current - 1);
    if (Math.abs(element.scrollTop - nextTop) > 1) {
      element.scrollTop = nextTop;
    }
    lastScrollAnchorRef.current = { ...anchor, index: nextIndex };
  }, [
    leadingRowsHeight,
    messageVirtualizer,
    selection.scrollRef,
    threadOrderKey,
    threadedMessages,
  ]);
  useLayoutEffect(() => {
    const element = selection.scrollRef.current;
    if (element && element.scrollTop > 1) {
      lastScrollAnchorRef.current = getScrollAnchor(
        element,
        messageVirtualizer
      );
    }
  }, [messageVirtualizer, selection.scrollRef]);
  const updateRowMeasurements = useCallback(
    function updateRowMeasurements(force = false): boolean {
      const element = selection.scrollRef.current;
      if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) {
        return false;
      }
      const layout = element.closest("[data-workspace-dock-main]");
      const animation = layout
        ?.getAnimations()
        .find(
          (candidate) =>
            candidate instanceof CSSTransition &&
            candidate.transitionProperty === "width" &&
            candidate.playState !== "finished" &&
            candidate.playState !== "idle"
        );
      if (animation) {
        pendingAnchorRef.current ??= getScrollAnchor(
          element,
          messageVirtualizer
        );
        if (pendingLayoutRef.current?.animation !== animation) {
          pendingLayoutRef.current = { animation };
          const settled = async () => {
            await Promise.allSettled([animation.finished]);
            if (pendingLayoutRef.current?.animation === animation) {
              pendingLayoutRef.current.animation = null;
              updateRowMeasurements(true);
            }
          };
          void settled();
        }
        return true;
      }
      const layoutSettled = force || pendingLayoutRef.current !== null;
      pendingLayoutRef.current = null;
      const width = element.clientWidth;
      const rows = element.querySelectorAll<HTMLLIElement>("li[data-index]");
      const firstRow = element.querySelector<HTMLLIElement>("li[data-index]");
      const height = firstRow?.offsetHeight ?? 0;
      if (
        !firstRow &&
        measuredWidthRef.current !== width &&
        !pendingAnchorRef.current
      ) {
        pendingAnchorRef.current = getScrollAnchor(element, messageVirtualizer);
      }
      if (
        height <= 0 ||
        (!layoutSettled &&
          measuredWidthRef.current === width &&
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
    },
    [messageVirtualizer, selection.scrollRef]
  );

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
      pendingAnchorRef.current ??= getScrollAnchor(
        element,
        messageVirtualizer,
        messageVirtualizer.scrollOffset ?? element.scrollTop
      );
      observer.disconnect();
      if (pendingLayoutRef.current) {
        pendingLayoutRef.current.animation = null;
      }
    };
  }, [messageVirtualizer, selection.scrollRef, updateRowMeasurements]);

  const virtualItems = messageVirtualizer.getVirtualItems();
  useEffect(() => {
    const element = selection.scrollRef.current;
    const { range } = messageVirtualizer;
    const candidates: ThreadPreloadCandidate[] = [];
    if (
      element &&
      range &&
      element.clientWidth > 0 &&
      element.clientHeight > 0
    ) {
      const top = messageVirtualizer.scrollOffset ?? element.scrollTop;
      let first = range.startIndex;
      const limit = first + THREAD_PRELOAD_LIMIT;
      for (
        let viewport = 0;
        viewport <= MESSAGE_LIST_PREFETCH_VIEWPORTS;
        viewport += 1
      ) {
        const end =
          viewport === 0
            ? range.endIndex
            : (messageVirtualizer.getVirtualItemForOffset(
                top + element.clientHeight * (viewport + 1) - 1
              )?.index ?? range.endIndex);
        const next = Math.min(end + 1, limit);
        const threads = threadedMessages
          .slice(first, next)
          .toSorted(
            (left, right) =>
              Number(right.unreadCount > 0) - Number(left.unreadCount > 0) ||
              Number(right.isImportant) - Number(left.isImportant)
          );
        for (const thread of threads) {
          const candidate = candidateForThread(thread);
          if (candidate) {
            candidates.push(candidate);
          }
        }
        first = next;
      }
    }
    preloaderRef.current?.update(candidates);
  });

  const latestCodeByThreadId = useThreadVerificationCodes(
    threadedMessages,
    list
  );
  useLayoutEffect((): (() => void) | undefined => {
    if (
      !list.hasNextPage ||
      list.isError ||
      list.isFetchingNextPage ||
      list.isPending
    ) {
      return undefined;
    }

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
    if (!element || element.clientWidth <= 0 || element.clientHeight <= 0) {
      return;
    }
    if (virtualItems.length > 0) {
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
    }

    if (isViewingMessage) {
      return;
    }
    const lastFocusedRow = lastFocusedRowRef.current;
    if (
      lastFocusedRow !== null &&
      !threadedMessages.some(
        (thread) => thread.threadId === lastFocusedRow.threadId
      )
    ) {
      const { activeElement } = document;
      const focusLostToUnmount =
        activeElement === null ||
        activeElement === document.body ||
        element.contains(activeElement);
      if (focusLostToUnmount) {
        const nextThread =
          threadedMessages[
            Math.min(lastFocusedRow.index, threadedMessages.length - 1)
          ];
        if (nextThread === undefined) {
          lastFocusedRowRef.current = null;
          element.focus({ preventScroll: true });
        } else {
          lastFocusedRowRef.current = {
            index: Math.min(lastFocusedRow.index, threadedMessages.length - 1),
            threadId: nextThread.threadId,
          };
          selection.focusThread(nextThread.threadId);
          if (pendingFocusRef.current?.threadId !== nextThread.threadId) {
            pendingFocusRef.current = {
              focusVisible: true,
              scrollIntoView: false,
              threadId: nextThread.threadId,
            };
          }
        }
      } else {
        lastFocusedRowRef.current = null;
      }
    } else if (threadId) {
      const currentIndex = threadedMessages.findIndex(
        (thread) => thread.threadId === threadId
      );
      if (currentIndex !== -1) {
        lastFocusedRowRef.current = { index: currentIndex, threadId };
      }
    } else if (
      document.activeElement !== null &&
      document.activeElement !== document.body &&
      !element.contains(document.activeElement)
    ) {
      lastFocusedRowRef.current = null;
    }

    const focus = pendingFocusRef.current;
    if (!focus || virtualItems.length === 0) {
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
  const handleRefresh = list.onRefresh;

  const emptyMessageLabel = getEmptyMessageLabel(
    list.activeMailbox,
    list.searchQuery
  );

  return (
    <div
      className={cn(mailListRowParts.viewport, {
        "pb-18": showSelectionTray,
      })}
      data-message-list-viewport
      onScrollCapture={(event) => {
        if (
          pendingLayoutRef.current &&
          Math.abs(
            event.currentTarget.scrollTop -
              (messageVirtualizer.scrollOffset ?? event.currentTarget.scrollTop)
          ) > 1
        ) {
          pendingAnchorRef.current = getScrollAnchor(
            event.currentTarget,
            messageVirtualizer
          );
        }
      }}
      onScroll={() => {
        const element = selection.scrollRef.current;
        if (element) {
          lastScrollAnchorRef.current =
            element.scrollTop <= 1
              ? null
              : getScrollAnchor(element, messageVirtualizer);
        }
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
      tabIndex={-1}
    >
      {hasLeadingRows && <div ref={leadingRowsRef}>{list.leadingRows}</div>}

      {isLoadingEmptyMessages && (
        <p
          aria-live="polite"
          className="px-2 py-8 text-center text-body text-muted-fg"
        >
          Loading messages…
        </p>
      )}

      {threadedMessages.length > 0 && (
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
                mailboxContextsByThreadId={list.mailboxContextsByThreadId}
                mailboxEmailAddress={context?.emailAddress}
                mailboxDisplayName={context?.displayName}
                mailboxId={context?.mailboxId ?? list.mailboxId}
                mailboxProvider={
                  context?.mailboxProvider ?? list.mailboxProvider
                }
                offsetY={virtualItem.start - leadingRowsHeight}
                onThreadFocus={handleThreadFocus}
                onThreadIntent={handleThreadIntent}
                onFilterByLabel={handleFilterByLabel}
                onOpenDraft={handleOpenDraft}
                onKeyboardOpen={onKeyboardOpenMessage}
                onThreadPress={selection.handleThreadPress}
                onThreadSnooze={onThreadSnooze}
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

      {list.isError && threadedMessages.length === 0 && (
        <div
          className="flex flex-col items-center gap-3 px-4 py-8 text-center"
          role="alert"
        >
          <p className="text-body text-destructive">
            {list.error instanceof Error
              ? list.error.message
              : "Could not load messages."}
          </p>
          <Button
            onClick={handleRefresh}
            size="sm"
            type="button"
            variant="secondary"
          >
            Try again
          </Button>
        </div>
      )}

      {list.isError && threadedMessages.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-center gap-3 px-4 py-4 text-caption"
          role="alert"
        >
          <span className="text-destructive">
            {list.error instanceof Error
              ? list.error.message
              : "Could not load more messages."}
          </span>
          <Button
            onClick={handleRefresh}
            size="xs"
            type="button"
            variant="secondary"
          >
            Try again
          </Button>
        </div>
      )}

      {!isLoadingEmptyMessages &&
        !list.isError &&
        list.suppressEmptyState !== true &&
        leadingRowsHeight === 0 &&
        threadedMessages.length === 0 && (
          <p className="px-2 py-8 text-center text-body text-muted-fg">
            {emptyMessageLabel}
          </p>
        )}

      {!list.isError &&
        threadedMessages.length > 0 &&
        list.isFetchingNextPage && (
          <p aria-live="polite" className="sr-only">
            Loading more messages…
          </p>
        )}
    </div>
  );
};
