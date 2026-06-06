"use client";

import { type QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
  syncMessages,
} from "~/lib/gmail/inbox-query";
import { useVisibleMessageRefresh } from "./use-visible-message-refresh";

type UseMailboxMessagesOptions = {
  activeMailbox: MailboxCategory;
  isDemoMode: boolean;
  messageId?: string;
  queryClient: QueryClient;
  searchQuery: string;
  selectedMailboxId: string | null;
};

const EMPTY_MESSAGE_PAGES: ListMessagesPageResult[] = [];

const useWindowActive = () => {
  const [isWindowActive, setIsWindowActive] = useState(false);

  useEffect(() => {
    const updateWindowActivity = () => {
      const nextIsWindowActive = document.visibilityState === "visible" && document.hasFocus();
      setIsWindowActive((current) =>
        current === nextIsWindowActive ? current : nextIsWindowActive,
      );
    };

    updateWindowActivity();
    window.addEventListener("focus", updateWindowActivity);
    window.addEventListener("blur", updateWindowActivity);
    document.addEventListener("visibilitychange", updateWindowActivity);

    return () => {
      window.removeEventListener("focus", updateWindowActivity);
      window.removeEventListener("blur", updateWindowActivity);
      document.removeEventListener("visibilitychange", updateWindowActivity);
    };
  }, []);

  return isWindowActive;
};

export const useMailboxMessages = ({
  activeMailbox,
  isDemoMode,
  messageId,
  queryClient,
  searchQuery,
  selectedMailboxId,
}: UseMailboxMessagesOptions) => {
  const isWindowActive = useWindowActive();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const normalizedQuery = searchQuery.trim();
  const messagesQuery = useInfiniteQuery(
    messagesQueryOptions(
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      !!selectedMailboxId,
    ),
  );
  const {
    data: messagesData,
    error: messagesError,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isPending,
    isRefetching,
  } = messagesQuery;
  const messages = messagesData?.pages ?? EMPTY_MESSAGE_PAGES;
  const hasLoadedMessages = !!messagesData?.pages.length;
  const isLiveSyncEnabled =
    !!selectedMailboxId &&
    !isDemoMode &&
    activeMailbox !== "drafts" &&
    normalizedQuery.length === 0 &&
    isWindowActive &&
    hasLoadedMessages &&
    !isManualRefreshing;
  const syncQuery = useQuery(
    liveSyncQueryOptions(
      queryClient,
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      isLiveSyncEnabled,
    ),
  );
  const flattenedMessages = useMemo(() => messages.flatMap((page) => page.messages), [messages]);

  const refreshMessages = useCallback(async () => {
    if (!selectedMailboxId) {
      return;
    }

    const liveSyncQueryKey = getLiveSyncQueryKey(selectedMailboxId, activeMailbox, normalizedQuery);
    const messagesQueryKey = getMessagesQueryKey(selectedMailboxId, activeMailbox, normalizedQuery);

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setIsManualRefreshing(true);
    try {
      await syncMessages(queryClient, selectedMailboxId, activeMailbox, normalizedQuery);
    } finally {
      setIsManualRefreshing(false);
    }
  }, [activeMailbox, normalizedQuery, queryClient, selectedMailboxId]);

  const refreshSearchResultsIfNeeded = useCallback(async () => {
    if (!selectedMailboxId || normalizedQuery.length === 0) return;
    await refreshLoadedMessagesPages(
      queryClient,
      selectedMailboxId,
      activeMailbox,
      normalizedQuery,
    );
  }, [activeMailbox, normalizedQuery, queryClient, selectedMailboxId]);

  const handleVisibleMessageIdsChange = useVisibleMessageRefresh({
    activeMailbox,
    messages,
    queryClient,
    searchQuery: normalizedQuery,
    selectedMailboxId,
  });

  let selectedMessage: MessageListItem | null = null;
  if (activeMailbox !== "drafts" && messageId) {
    for (const message of flattenedMessages) {
      if (message.id === messageId) {
        selectedMessage = message;
        break;
      }
    }
  }

  const isRefreshing =
    isManualRefreshing || syncQuery.isFetching || (isRefetching && !isFetchingNextPage);
  const isLoadingEmptyMessages =
    !messages.some((page) => page.messages.length > 0) && (isPending || isRefreshing);

  const loadMoreMessages = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || isPending || isError) {
      return;
    }

    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isError, isFetchingNextPage, isPending]);

  const listState = useMemo(
    () => ({
      error: messagesError ?? null,
      hasNextPage: !!hasNextPage,
      isError,
      isFetchingNextPage,
      isPending,
      isRefreshing,
      messages,
    }),
    [hasNextPage, isError, isFetchingNextPage, isPending, isRefreshing, messages, messagesError],
  );

  return {
    flattenedMessages,
    handleVisibleMessageIdsChange,
    hasMessagePages: !!messagesData?.pages.length,
    isLoadingEmptyMessages,
    isRefreshing,
    listState,
    loadMoreMessages,
    messagesPending: isPending,
    refreshMessages,
    refreshSearchResultsIfNeeded,
    selectedMessage,
  };
};
