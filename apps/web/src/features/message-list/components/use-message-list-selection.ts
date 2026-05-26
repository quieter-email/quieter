"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import { useMemo, useRef, useState } from "react";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import type { ThreadPressGesture } from "./message-list-types";

const SCROLL_TOP_EPSILON_PX = 2;
const SCROLL_WAIT_TIMEOUT_MS = 600;

type SelectionState = {
  scopeKey: string;
  selectedThreadIds: Set<string>;
  selectionAnchorThreadId: string | null;
};

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
  const selectionScopeKey = `${activeMailbox}:${searchQuery}`;
  const loadedThreadIdSet = useMemo(
    () => new Set(threadedMessages.map((thread) => thread.threadId)),
    [threadedMessages],
  );
  const [selectionState, setSelectionState] = useState<SelectionState>(() => ({
    scopeKey: selectionScopeKey,
    selectedThreadIds: new Set(),
    selectionAnchorThreadId: null,
  }));
  const scopedSelectionState =
    selectionState.scopeKey === selectionScopeKey
      ? selectionState
      : {
          scopeKey: selectionScopeKey,
          selectedThreadIds: new Set<string>(),
          selectionAnchorThreadId: null,
        };
  const selectedThreadIds = new Set(
    Array.from(scopedSelectionState.selectedThreadIds).filter((threadId) =>
      loadedThreadIdSet.has(threadId),
    ),
  );
  const selectionAnchorThreadId =
    scopedSelectionState.selectionAnchorThreadId &&
    loadedThreadIdSet.has(scopedSelectionState.selectionAnchorThreadId)
      ? scopedSelectionState.selectionAnchorThreadId
      : null;
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

  const getCurrentSelectionState = (current: SelectionState) => {
    if (current.scopeKey !== selectionScopeKey) {
      return {
        selectedThreadIds: new Set<string>(),
        selectionAnchorThreadId: null,
      };
    }

    return {
      selectedThreadIds: new Set(
        Array.from(current.selectedThreadIds).filter((threadId) => loadedThreadIdSet.has(threadId)),
      ),
      selectionAnchorThreadId:
        current.selectionAnchorThreadId && loadedThreadIdSet.has(current.selectionAnchorThreadId)
          ? current.selectionAnchorThreadId
          : null,
    };
  };

  const setSelection = (
    updater: (current: {
      selectedThreadIds: Set<string>;
      selectionAnchorThreadId: string | null;
    }) => {
      selectedThreadIds: Set<string>;
      selectionAnchorThreadId: string | null;
    },
  ) => {
    setSelectionState((current) => ({
      scopeKey: selectionScopeKey,
      ...updater(getCurrentSelectionState(current)),
    }));
  };

  const clearSelection = () => {
    setSelectionState({
      scopeKey: selectionScopeKey,
      selectedThreadIds: new Set(),
      selectionAnchorThreadId: null,
    });
  };

  const selectSingleThread = (threadId: string) => {
    setSelectionState({
      scopeKey: selectionScopeKey,
      selectedThreadIds: new Set([threadId]),
      selectionAnchorThreadId: threadId,
    });
  };

  const toggleThreadSelection = (threadId: string) => {
    setSelection((current) => {
      const next = new Set(current.selectedThreadIds);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }

      return {
        selectedThreadIds: next,
        selectionAnchorThreadId: threadId,
      };
    });
  };

  const startAdditiveSelection = (threadId: string) => {
    setSelection(() => {
      const next = new Set<string>();

      if (activeThreadId && threadedMessages.find((thread) => thread.threadId === activeThreadId)) {
        next.add(activeThreadId);
      }

      next.add(threadId);
      return {
        selectedThreadIds: next,
        selectionAnchorThreadId: threadId,
      };
    });
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

    setSelection((current) => {
      if (anchorIndex == null || anchorIndex < 0) {
        if (additive) {
          const next = new Set(current.selectedThreadIds);

          if (
            activeThreadId &&
            threadedMessages.find((thread) => thread.threadId === activeThreadId)
          ) {
            next.add(activeThreadId);
          }

          next.add(threadId);
          return {
            selectedThreadIds: next,
            selectionAnchorThreadId: threadId,
          };
        }

        return {
          selectedThreadIds: new Set([threadId]),
          selectionAnchorThreadId: threadId,
        };
      }

      const next = additive ? new Set(current.selectedThreadIds) : new Set<string>();
      const startIndex = Math.min(anchorIndex, targetIndex);
      const endIndex = Math.max(anchorIndex, targetIndex);

      for (let index = startIndex; index <= endIndex; index += 1) {
        const rangeThreadId = threadedMessages[index].threadId;
        if (rangeThreadId) {
          next.add(rangeThreadId);
        }
      }

      return {
        selectedThreadIds: next,
        selectionAnchorThreadId: threadId,
      };
    });
  };

  const toggleAllLoadedThreads = (selected: boolean) => {
    setSelectionState({
      scopeKey: selectionScopeKey,
      selectedThreadIds: selected
        ? new Set(threadedMessages.map((thread) => thread.threadId))
        : new Set(),
      selectionAnchorThreadId: (selected && threadedMessages[0]?.threadId) || null,
    });
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

    setSelection((current) => ({
      selectedThreadIds: current.selectedThreadIds,
      selectionAnchorThreadId: thread.threadId,
    }));

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
