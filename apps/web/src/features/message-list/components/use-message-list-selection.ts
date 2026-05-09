"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useRef, useState } from "react";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import type { ThreadPressGesture } from "./message-list-types";

const SCROLL_TOP_EPSILON_PX = 2;
const SCROLL_WAIT_TIMEOUT_MS = 600;

export const useMessageListSelection = ({
  activeMailbox,
  activeThreadId,
  onActivateMessage,
  onDeactivateActiveMessage,
  searchQuery,
  threadedMessages,
}: {
  activeMailbox: MailboxCategory;
  activeThreadId: string | null;
  onActivateMessage: (messageId: string) => void;
  onDeactivateActiveMessage: () => void;
  searchQuery: string;
  threadedMessages: ThreadListEntry[];
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollToTopRef = useRef(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [selectionAnchorThreadId, setSelectionAnchorThreadId] = useState<string | null>(null);
  const selectedThreads = Array.from(selectedThreadIds).flatMap((threadId) => {
    const thread = threadedMessages.find((entry) => entry.threadId === threadId);
    return thread ? [thread] : [];
  });
  const allSelected =
    threadedMessages.length > 0 && selectedThreadIds.size === threadedMessages.length;
  const selectionIndeterminate = selectedThreadIds.size > 0 && !allSelected;

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

  const scrollListToTop = () => {
    if (!scrollRef.current || scrollRef.current.scrollTop <= SCROLL_TOP_EPSILON_PX) {
      return false;
    }

    isProgrammaticScrollToTopRef.current = true;

    const scrollElement = scrollRef.current;
    scrollElement.scrollTo({ top: 0, behavior: "smooth" });
    void waitForSmoothScrollTop(scrollElement)
      .then(() => waitForNextPaint())
      .finally(() => {
        isProgrammaticScrollToTopRef.current = false;
      });

    return true;
  };

  useEffect(() => {
    setSelectedThreadIds(new Set());
    setSelectionAnchorThreadId(null);
  }, [activeMailbox, searchQuery]);

  useEffect(() => {
    const loadedThreadIdSet = new Set(threadedMessages.map((thread) => thread.threadId));
    setSelectedThreadIds((current) => {
      const nextSelectedIds = Array.from(current).filter((threadId) =>
        loadedThreadIdSet.has(threadId),
      );
      return nextSelectedIds.length === current.size ? current : new Set(nextSelectedIds);
    });
    setSelectionAnchorThreadId(
      (current) => (current && loadedThreadIdSet.has(current) && current) || null,
    );
  }, [threadedMessages]);

  const clearSelection = () => {
    setSelectedThreadIds(new Set());
    setSelectionAnchorThreadId(null);
  };

  const selectSingleThread = (threadId: string) => {
    setSelectedThreadIds(new Set([threadId]));
    setSelectionAnchorThreadId(threadId);
  };

  const toggleThreadSelection = (threadId: string) => {
    setSelectedThreadIds((current) => {
      const next = new Set(current);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
    setSelectionAnchorThreadId(threadId);
  };

  const startAdditiveSelection = (threadId: string) => {
    setSelectedThreadIds(() => {
      const next = new Set<string>();

      if (activeThreadId && threadedMessages.find((thread) => thread.threadId === activeThreadId)) {
        next.add(activeThreadId);
      }

      next.add(threadId);
      return next;
    });
    setSelectionAnchorThreadId(threadId);
  };

  const selectThreadRange = (threadId: string, additive: boolean) => {
    const targetIndex = threadedMessages.findIndex((thread) => thread.threadId === threadId);
    const fallbackAnchorThreadId =
      selectionAnchorThreadId ??
      ((activeThreadId && threadedMessages.find((thread) => thread.threadId === activeThreadId)) ||
        null);
    const anchorIndex = fallbackAnchorThreadId
      ? threadedMessages.findIndex((thread) => thread.threadId === fallbackAnchorThreadId)
      : undefined;

    if (targetIndex < 0) return;

    setSelectedThreadIds((current) => {
      if (anchorIndex == null || anchorIndex < 0) {
        if (additive) {
          const next = new Set(current);

          if (
            activeThreadId &&
            threadedMessages.find((thread) => thread.threadId === activeThreadId)
          ) {
            next.add(activeThreadId);
          }

          next.add(threadId);
          return next;
        }

        return new Set([threadId]);
      }

      const next = additive ? new Set(current) : new Set<string>();
      const startIndex = Math.min(anchorIndex, targetIndex);
      const endIndex = Math.max(anchorIndex, targetIndex);

      for (let index = startIndex; index <= endIndex; index += 1) {
        const rangeThreadId = threadedMessages[index].threadId;
        if (rangeThreadId) {
          next.add(rangeThreadId);
        }
      }

      return next;
    });
    setSelectionAnchorThreadId(threadId);
  };

  const toggleAllLoadedThreads = (selected: boolean) => {
    setSelectedThreadIds(
      selected ? new Set(threadedMessages.map((thread) => thread.threadId)) : new Set(),
    );
    setSelectionAnchorThreadId((selected && threadedMessages[0]?.threadId) || null);
  };

  const handleThreadSelectionPress = (thread: ThreadListEntry, gesture: ThreadPressGesture) => {
    if (gesture.range) {
      selectThreadRange(thread.threadId, gesture.additive);
      return;
    }

    if (selectedThreadIds.size == 0 && gesture.additive) {
      startAdditiveSelection(thread.threadId);
      return;
    }

    if (selectedThreadIds.size == 0 && !gesture.additive) {
      selectSingleThread(thread.threadId);
      return;
    }

    toggleThreadSelection(thread.threadId);
  };

  const handleThreadPress = (thread: ThreadListEntry, gesture: ThreadPressGesture) => {
    if (gesture.range) {
      selectThreadRange(thread.threadId, gesture.additive);
      return;
    }

    if (selectedThreadIds.size == 0 && gesture.additive) {
      startAdditiveSelection(thread.threadId);
      return;
    }

    if (selectedThreadIds.size > 0 && !gesture.additive) {
      toggleThreadSelection(thread.threadId);
      return;
    }

    if (gesture.additive) {
      toggleThreadSelection(thread.threadId);
      return;
    }

    setSelectionAnchorThreadId(thread.threadId);

    if (activeThreadId !== null && activeThreadId === thread.threadId) {
      onDeactivateActiveMessage();
      return;
    }

    onActivateMessage(thread.anchorMessage.id);
  };

  useHotkey(
    "Mod+A",
    () => {
      toggleAllLoadedThreads(true);
    },
    {
      enabled: threadedMessages.length > 0,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    },
  );

  useHotkey(
    "Escape",
    () => {
      clearSelection();
    },
    {
      enabled: selectedThreadIds.size > 0,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    },
  );

  return {
    allSelected,
    clearSelection,
    handleThreadPress,
    handleThreadSelectionPress,
    isProgrammaticScrollToTopRef,
    scrollListToTop,
    scrollRef,
    selectedThreadIds,
    selectedThreads,
    selectionIndeterminate,
    toggleAllLoadedThreads,
  };
};
