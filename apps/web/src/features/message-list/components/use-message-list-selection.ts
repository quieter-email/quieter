"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { shouldIgnoreAppShortcut } from "#/features/hotkeys/domain/hotkey-guards";
import { delay, scheduleFireAndForget } from "#/lib/delay";
import type { MailboxCategory } from "#/lib/gmail/gmail";
import type { ThreadListEntry } from "#/lib/gmail/thread-list";

import type { ThreadPressGesture } from "./message-list-types";

const SCROLL_TOP_EPSILON_PX = 2;
const SCROLL_WAIT_TIMEOUT_MS = 600;
const FRAME_DELAY_MS = 32;

type SelectionState = {
  scopeKey: string;
  selectedThreadIds: Set<string>;
  selectionAnchorThreadId: string | null;
};

const waitForSmoothScrollTop = async (element: HTMLDivElement) => {
  const deadline = Date.now() + SCROLL_WAIT_TIMEOUT_MS;
  const poll = async (): Promise<void> => {
    if (element.scrollTop <= SCROLL_TOP_EPSILON_PX || Date.now() >= deadline) {
      return;
    }
    await delay(FRAME_DELAY_MS);
    await poll();
  };
  await poll();
};

const waitForNextPaint = async () => {
  await delay(FRAME_DELAY_MS);
  await delay(FRAME_DELAY_MS);
};

export const useMessageListSelection = ({
  activeMailbox,
  activeThreadId,
  mailboxId,
  onActivateMessage,
  onDeactivateActiveMessage,
  searchQuery,
  threadedMessages,
}: {
  activeMailbox: MailboxCategory;
  activeThreadId: string | null;
  mailboxId: string;
  onActivateMessage: (messageId: string) => void;
  onDeactivateActiveMessage: () => void;
  searchQuery: string;
  threadedMessages: ThreadListEntry[];
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollToTopRef = useRef(false);
  const focusRingRequestedRef = useRef(false);
  const selectionScopeKey = `${mailboxId}:${activeMailbox}:${searchQuery}`;
  const loadedThreadIdSet = useMemo(
    () => new Set(threadedMessages.map((thread) => thread.threadId)),
    [threadedMessages]
  );
  const [selectionState, setSelectionState] = useState<SelectionState>(() => ({
    scopeKey: selectionScopeKey,
    selectedThreadIds: new Set(),
    selectionAnchorThreadId: null,
  }));
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const scopedSelectionState = useMemo(
    () =>
      selectionState.scopeKey === selectionScopeKey
        ? selectionState
        : {
            scopeKey: selectionScopeKey,
            selectedThreadIds: new Set<string>(),
            selectionAnchorThreadId: null,
          },
    [selectionScopeKey, selectionState]
  );
  const selectedThreadIds = useMemo(
    () =>
      new Set(
        [...scopedSelectionState.selectedThreadIds].filter((threadId) =>
          loadedThreadIdSet.has(threadId)
        )
      ),
    [loadedThreadIdSet, scopedSelectionState.selectedThreadIds]
  );
  const selectionAnchorThreadId = (() => {
    const anchorId = scopedSelectionState.selectionAnchorThreadId;
    if ((anchorId ?? "") === "" || !loadedThreadIdSet.has(anchorId ?? "")) {
      return null;
    }
    return anchorId;
  })();
  const selectedThreads = useMemo(
    () =>
      [...selectedThreadIds].flatMap((threadId) => {
        const thread = threadedMessages.find(
          (entry) => entry.threadId === threadId
        );
        return thread ? [thread] : [];
      }),
    [selectedThreadIds, threadedMessages]
  );
  const allSelected =
    threadedMessages.length > 0 &&
    selectedThreadIds.size === threadedMessages.length;
  const selectionIndeterminate =
    selectedThreadIds.size > 0 &&
    selectedThreadIds.size !== threadedMessages.length;
  const focusedThread = (() => {
    const focusedById =
      (focusedThreadId ?? "") === ""
        ? undefined
        : threadedMessages.find(
            (thread) => thread.threadId === focusedThreadId
          );
    const focusedByActive =
      (activeThreadId ?? "") === ""
        ? undefined
        : threadedMessages.find((thread) => thread.threadId === activeThreadId);
    return focusedById ?? focusedByActive ?? threadedMessages[0] ?? null;
  })();
  const resolvedFocusedThreadId = focusedThread?.threadId ?? null;
  const activeThreadIdRef = useRef(activeThreadId);
  const focusedThreadIdRef = useRef(focusedThreadId);
  const onActivateMessageRef = useRef(onActivateMessage);
  const onDeactivateActiveMessageRef = useRef(onDeactivateActiveMessage);
  const selectedThreadIdsRef = useRef(selectedThreadIds);
  const selectionAnchorThreadIdRef = useRef(selectionAnchorThreadId);
  const threadedMessagesRef = useRef(threadedMessages);

  useLayoutEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    focusedThreadIdRef.current = focusedThreadId;
    onActivateMessageRef.current = onActivateMessage;
    onDeactivateActiveMessageRef.current = onDeactivateActiveMessage;
    selectedThreadIdsRef.current = selectedThreadIds;
    selectionAnchorThreadIdRef.current = selectionAnchorThreadId;
    threadedMessagesRef.current = threadedMessages;
  }, [
    activeThreadId,
    focusedThreadId,
    onActivateMessage,
    onDeactivateActiveMessage,
    selectedThreadIds,
    selectionAnchorThreadId,
    threadedMessages,
  ]);

  const scrollListToTop = useCallback(() => {
    if (
      !scrollRef.current ||
      scrollRef.current.scrollTop <= SCROLL_TOP_EPSILON_PX
    ) {
      return false;
    }

    isProgrammaticScrollToTopRef.current = true;

    const scrollElement = scrollRef.current;
    scrollElement.scrollTo({ behavior: "smooth", top: 0 });

    const finishScroll = async () => {
      try {
        await waitForSmoothScrollTop(scrollElement);
        await waitForNextPaint();
      } finally {
        isProgrammaticScrollToTopRef.current = false;
      }
    };
    scheduleFireAndForget(finishScroll);

    return true;
  }, []);

  const getCurrentSelectionState = useCallback(
    (current: SelectionState) => {
      if (current.scopeKey !== selectionScopeKey) {
        return {
          selectedThreadIds: new Set<string>(),
          selectionAnchorThreadId: null,
        };
      }

      const anchorId = current.selectionAnchorThreadId;
      const resolvedAnchor =
        (anchorId ?? "") !== "" && loadedThreadIdSet.has(anchorId ?? "")
          ? anchorId
          : null;

      return {
        selectedThreadIds: new Set(
          [...current.selectedThreadIds].filter((threadId) =>
            loadedThreadIdSet.has(threadId)
          )
        ),
        selectionAnchorThreadId: resolvedAnchor,
      };
    },
    [loadedThreadIdSet, selectionScopeKey]
  );

  const setSelection = useCallback(
    (
      updater: (current: {
        selectedThreadIds: Set<string>;
        selectionAnchorThreadId: string | null;
      }) => {
        selectedThreadIds: Set<string>;
        selectionAnchorThreadId: string | null;
      }
    ) => {
      setSelectionState((current) => ({
        scopeKey: selectionScopeKey,
        ...updater(getCurrentSelectionState(current)),
      }));
    },
    [getCurrentSelectionState, selectionScopeKey]
  );

  const clearSelection = useCallback(() => {
    setSelectionState({
      scopeKey: selectionScopeKey,
      selectedThreadIds: new Set(),
      selectionAnchorThreadId: null,
    });
  }, [selectionScopeKey]);

  const selectSingleThread = useCallback(
    (threadId: string) => {
      setSelectionState({
        scopeKey: selectionScopeKey,
        selectedThreadIds: new Set([threadId]),
        selectionAnchorThreadId: threadId,
      });
    },
    [selectionScopeKey]
  );

  const toggleThreadSelection = useCallback(
    (threadId: string) => {
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
    },
    [setSelection]
  );

  const startAdditiveSelection = useCallback(
    (threadId: string) => {
      setSelection(() => {
        const currentActiveThreadId = activeThreadIdRef.current;
        const currentThreadedMessages = threadedMessagesRef.current;
        const next = new Set<string>();

        if (
          (currentActiveThreadId ?? "") !== "" &&
          currentThreadedMessages.some(
            (thread) => thread.threadId === currentActiveThreadId
          )
        ) {
          next.add(currentActiveThreadId ?? "");
        }

        next.add(threadId);
        return {
          selectedThreadIds: next,
          selectionAnchorThreadId: threadId,
        };
      });
    },
    [setSelection]
  );

  const selectThreadRange = useCallback(
    (threadId: string, additive: boolean) => {
      const currentActiveThreadId = activeThreadIdRef.current;
      const currentSelectionAnchorThreadId = selectionAnchorThreadIdRef.current;
      const currentThreadedMessages = threadedMessagesRef.current;
      const targetIndex = currentThreadedMessages.findIndex(
        (thread) => thread.threadId === threadId
      );
      const activeThreadEntry =
        (currentActiveThreadId ?? "") === ""
          ? undefined
          : currentThreadedMessages.find(
              (thread) => thread.threadId === currentActiveThreadId
            );
      const fallbackAnchorThreadId =
        currentSelectionAnchorThreadId ?? activeThreadEntry?.threadId;
      const anchorIndex =
        (fallbackAnchorThreadId ?? "") === ""
          ? -1
          : currentThreadedMessages.findIndex(
              (thread) => thread.threadId === fallbackAnchorThreadId
            );

      if (targetIndex === -1) {
        return;
      }

      setSelection((current) => {
        if (anchorIndex < 0) {
          if (additive) {
            const next = new Set(current.selectedThreadIds);

            if (
              (currentActiveThreadId ?? "") !== "" &&
              currentThreadedMessages.some(
                (thread) => thread.threadId === currentActiveThreadId
              )
            ) {
              next.add(currentActiveThreadId ?? "");
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

        const next = additive
          ? new Set(current.selectedThreadIds)
          : new Set<string>();
        const startIndex = Math.min(anchorIndex, targetIndex);
        const endIndex = Math.max(anchorIndex, targetIndex);

        for (let index = startIndex; index <= endIndex; index += 1) {
          const rangeThreadId = currentThreadedMessages[index]?.threadId;
          if ((rangeThreadId ?? "") !== "") {
            next.add(rangeThreadId ?? "");
          }
        }

        return {
          selectedThreadIds: next,
          selectionAnchorThreadId: threadId,
        };
      });
    },
    [setSelection]
  );

  const toggleAllLoadedThreads = useCallback(
    (selected: boolean) => {
      const firstThreadId = threadedMessages[0]?.threadId ?? null;
      setSelectionState({
        scopeKey: selectionScopeKey,
        selectedThreadIds: selected
          ? new Set(threadedMessages.map((thread) => thread.threadId))
          : new Set(),
        selectionAnchorThreadId: selected ? firstThreadId : null,
      });
    },
    [selectionScopeKey, threadedMessages]
  );

  const handleThreadSelectionPress = useCallback(
    (thread: ThreadListEntry, gesture: ThreadPressGesture) => {
      setFocusedThreadId(thread.threadId);
      const currentSelectedThreadIds = selectedThreadIdsRef.current;

      if (gesture.range) {
        selectThreadRange(thread.threadId, gesture.additive);
        return;
      }

      if (currentSelectedThreadIds.size === 0 && gesture.additive) {
        startAdditiveSelection(thread.threadId);
        return;
      }

      if (currentSelectedThreadIds.size === 0 && !gesture.additive) {
        selectSingleThread(thread.threadId);
        return;
      }

      toggleThreadSelection(thread.threadId);
    },
    [
      selectSingleThread,
      selectThreadRange,
      startAdditiveSelection,
      toggleThreadSelection,
    ]
  );

  const consumeFocusRingRequest = useCallback(() => {
    const requested = focusRingRequestedRef.current;
    focusRingRequestedRef.current = false;
    return requested;
  }, []);

  const requestFocusRing = useCallback(() => {
    focusRingRequestedRef.current = true;
  }, []);

  const handleThreadPress = useCallback(
    (thread: ThreadListEntry, gesture: ThreadPressGesture) => {
      focusRingRequestedRef.current = false;
      setFocusedThreadId(thread.threadId);
      const currentActiveThreadId = activeThreadIdRef.current;
      const currentSelectedThreadIds = selectedThreadIdsRef.current;

      if (gesture.range) {
        selectThreadRange(thread.threadId, gesture.additive);
        return;
      }

      if (currentSelectedThreadIds.size === 0 && gesture.additive) {
        startAdditiveSelection(thread.threadId);
        return;
      }

      if (currentSelectedThreadIds.size > 0 && !gesture.additive) {
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

      if (
        (currentActiveThreadId ?? "") !== "" &&
        currentActiveThreadId === thread.threadId
      ) {
        onDeactivateActiveMessageRef.current();
        return;
      }

      onActivateMessageRef.current(thread.anchorMessage.id);
    },
    [
      selectThreadRange,
      setSelection,
      startAdditiveSelection,
      toggleThreadSelection,
    ]
  );

  const focusThreadByOffset = useCallback((offset: number) => {
    const currentThreadedMessages = threadedMessagesRef.current;
    if (currentThreadedMessages.length === 0) {
      return;
    }

    const currentFocusedThreadId =
      focusedThreadIdRef.current ?? activeThreadIdRef.current;
    const currentIndex =
      (currentFocusedThreadId ?? "") === ""
        ? -1
        : currentThreadedMessages.findIndex(
            (thread) => thread.threadId === currentFocusedThreadId
          );

    let nextIndex: number;
    if (currentIndex === -1) {
      if (offset > 0) {
        nextIndex = 0;
      } else {
        nextIndex = currentThreadedMessages.length - 1;
      }
    } else {
      nextIndex = Math.max(
        0,
        Math.min(currentThreadedMessages.length - 1, currentIndex + offset)
      );
    }

    const nextThreadId = currentThreadedMessages[nextIndex]?.threadId;
    if ((nextThreadId ?? "") !== "") {
      focusRingRequestedRef.current = true;
      setFocusedThreadId(nextThreadId ?? null);
    }
  }, []);
  const focusThread = useCallback((threadId: string | null) => {
    setFocusedThreadId(threadId);
  }, []);

  const openFocusedThread = useCallback(() => {
    const currentThreadedMessages = threadedMessagesRef.current;
    const currentFocusedThreadId =
      focusedThreadIdRef.current ?? activeThreadIdRef.current;
    const threadByFocus =
      (currentFocusedThreadId ?? "") === ""
        ? undefined
        : currentThreadedMessages.find(
            (entry) => entry.threadId === currentFocusedThreadId
          );
    const thread = threadByFocus ?? currentThreadedMessages[0];

    if (thread === undefined) {
      return;
    }
    focusRingRequestedRef.current = true;
    setFocusedThreadId(thread.threadId);
    onActivateMessageRef.current(thread.anchorMessage.id);
  }, []);

  const toggleFocusedThreadSelection = useCallback(() => {
    const currentThreadedMessages = threadedMessagesRef.current;
    const currentFocusedThreadId =
      focusedThreadIdRef.current ?? activeThreadIdRef.current;
    const threadByFocus =
      (currentFocusedThreadId ?? "") === ""
        ? undefined
        : currentThreadedMessages.find(
            (entry) => entry.threadId === currentFocusedThreadId
          );
    const thread = threadByFocus ?? currentThreadedMessages[0];

    if (thread === undefined) {
      return;
    }
    focusRingRequestedRef.current = true;
    setFocusedThreadId(thread.threadId);
    toggleThreadSelection(thread.threadId);
  }, [toggleThreadSelection]);

  useHotkey(
    "Mod+A",
    (event) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      toggleAllLoadedThreads(true);
    },
    {
      enabled: threadedMessages.length > 0,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    }
  );

  useHotkey(
    "Escape",
    (event) => {
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }
      clearSelection();
    },
    {
      enabled: selectedThreadIds.size > 0,
      ignoreInputs: true,
      preventDefault: true,
      stopPropagation: true,
    }
  );

  return {
    allSelected,
    clearSelection,
    consumeFocusRingRequest,
    focusThread,
    focusThreadByOffset,
    focusedThread,
    focusedThreadId: resolvedFocusedThreadId,
    handleThreadPress,
    handleThreadSelectionPress,
    isProgrammaticScrollToTopRef,
    keyboardFocusedThreadId: focusedThreadId,
    openFocusedThread,
    requestFocusRing,
    scrollListToTop,
    scrollRef,
    selectSingleThread,
    selectedThreadIds,
    selectedThreads,
    selectionIndeterminate,
    toggleAllLoadedThreads,
    toggleFocusedThreadSelection,
  };
};
