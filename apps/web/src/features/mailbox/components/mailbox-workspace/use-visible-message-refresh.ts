"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { ListMessagesPageResult, MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import { DEMO_MAILBOX_ID } from "~/lib/gmail/demo-mail";
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
  const queueRef = useRef<Set<string>>(new Set());
  const recentAttemptsRef = useRef<Map<string, number>>(new Map());
  const inFlightIdsRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const flushQueueRef = useRef<() => void>(() => {});

  const scheduleRefresh = useCallback((delayMs = VISIBLE_MESSAGE_REFRESH_DEBOUNCE_MS) => {
    if (timeoutRef.current) return;

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      flushQueueRef.current();
    }, delayMs);
  }, []);

  flushQueueRef.current = () => {
    if (inFlightRef.current) return;

    if (!selectedMailboxId || selectedMailboxId === DEMO_MAILBOX_ID || activeMailbox === "drafts") {
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
  };

  const handleVisibleMessageIdsChange = useCallback(
    (messageIds: readonly string[]) => {
      if (
        !selectedMailboxId ||
        selectedMailboxId === DEMO_MAILBOX_ID ||
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
    [activeMailbox, messages, scheduleRefresh, selectedMailboxId],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      queueRef.current.clear();
      recentAttemptsRef.current.clear();
      inFlightIdsRef.current.clear();
      inFlightRef.current = false;
    };
  }, [activeMailbox, searchQuery, selectedMailboxId]);

  return handleVisibleMessageIdsChange;
};
