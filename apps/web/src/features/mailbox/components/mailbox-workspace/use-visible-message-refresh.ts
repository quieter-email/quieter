"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ListMessagesPageResult, MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import { isSandboxMailboxId } from "~/lib/gmail/demo-mail";
import { refreshVisibleMailboxMessages } from "~/lib/gmail/inbox-query";
import {
  collectVisibleMessageRefreshBatch,
  queueVisibleMessageRefreshIds,
} from "../visible-message-refresh";

const VISIBLE_MESSAGE_REFRESH_DEBOUNCE_MS = 250;
const VISIBLE_MESSAGE_REFRESH_COOLDOWN_MS = 1000 * 60 * 5;
const VISIBLE_MESSAGE_REFRESH_MAX_BATCH_SIZE = 25;
const VISIBLE_MESSAGE_REFRESH_PREFIX_PAGE_SKIP = 3;

const getPrefixMessageIds = (pages: readonly { messages: readonly MessageListItem[] }[]) => {
  return new Set(
    pages
      .slice(0, VISIBLE_MESSAGE_REFRESH_PREFIX_PAGE_SKIP)
      .flatMap((page) => page.messages.map((message) => message.id)),
  );
};

export const useVisibleMessageRefresh = ({
  activeMailbox,
  messages,
  queryClient,
  searchQuery,
  selectedMailboxId,
}: {
  activeMailbox: MailboxCategory;
  messages: ListMessagesPageResult[];
  queryClient: QueryClient;
  searchQuery: string;
  selectedMailboxId: string | null;
}) => {
  const [queueRef] = useState(() => ({ current: new Set<string>() }));
  const [recentAttemptsRef] = useState(() => ({ current: new Map<string, number>() }));
  const [inFlightIdsRef] = useState(() => ({ current: new Set<string>() }));
  const inFlightRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const flushQueueRef = useRef<() => void>(() => {});

  const scheduleRefresh = useCallback(
    (delayMs = VISIBLE_MESSAGE_REFRESH_DEBOUNCE_MS) => {
      if (timeoutRef.current) return;

      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        flushQueueRef.current();
      }, delayMs);
    },
    [VISIBLE_MESSAGE_REFRESH_DEBOUNCE_MS],
  );

  const flushQueue = useCallback(() => {
    if (inFlightRef.current) return;

    if (!selectedMailboxId || isSandboxMailboxId(selectedMailboxId) || activeMailbox === "drafts") {
      queueRef.current.clear();
      return;
    }

    const messageIds = collectVisibleMessageRefreshBatch({
      cooldownMs: VISIBLE_MESSAGE_REFRESH_COOLDOWN_MS,
      inFlightMessageIds: inFlightIdsRef.current,
      maxBatchSize: VISIBLE_MESSAGE_REFRESH_MAX_BATCH_SIZE,
      now: Date.now(),
      queuedMessageIds: queueRef.current,
      recentAttemptByMessageId: recentAttemptsRef.current,
      skipMessageIds: getPrefixMessageIds(messages),
    });

    if (messageIds.length === 0) {
      if (queueRef.current.size > 0) {
        scheduleRefresh(0);
      }
      return;
    }

    inFlightRef.current = true;
    void refreshVisibleMailboxMessages(queryClient, {
      mailboxId: selectedMailboxId,
      mailbox: activeMailbox,
      messageIds,
      searchQuery,
    })
      .catch(() => {})
      .finally(() => {
        for (const messageId of messageIds) {
          inFlightIdsRef.current.delete(messageId);
        }

        inFlightRef.current = false;
        if (queueRef.current.size > 0) {
          scheduleRefresh(0);
        }
      });
  }, [
    activeMailbox,
    inFlightIdsRef,
    messages,
    queryClient,
    queueRef,
    recentAttemptsRef,
    scheduleRefresh,
    searchQuery,
    selectedMailboxId,
  ]);

  useLayoutEffect(() => {
    flushQueueRef.current = flushQueue;
  }, [flushQueue]);

  const handleVisibleMessageIdsChange = useCallback(
    (messageIds: readonly string[]) => {
      if (
        !selectedMailboxId ||
        isSandboxMailboxId(selectedMailboxId) ||
        activeMailbox === "drafts" ||
        messageIds.length === 0
      ) {
        return;
      }

      const hasQueuedMessage = queueVisibleMessageRefreshIds(
        queueRef.current,
        messageIds,
        getPrefixMessageIds(messages),
      );

      if (hasQueuedMessage) {
        scheduleRefresh();
      }
    },
    [activeMailbox, messages, queueRef, scheduleRefresh, selectedMailboxId],
  );

  // react-doctor-disable-next-line react-doctor/exhaustive-deps
  useEffect(() => {
    return () => {
      const timeoutId = timeoutRef.current;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutRef.current = null;
      }

      queueRef.current.clear();
      recentAttemptsRef.current.clear();
      inFlightIdsRef.current.clear();
      inFlightRef.current = false;
    };
  }, [activeMailbox, inFlightIdsRef, queueRef, recentAttemptsRef, searchQuery, selectedMailboxId]);

  return handleVisibleMessageIdsChange;
};
