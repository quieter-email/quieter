"use client";

import { type QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type SetStateAction, useMemo } from "react";
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
  isManualRefreshing: boolean;
  isWindowActive: boolean;
  messageId?: string;
  queryClient: QueryClient;
  searchQuery: string;
  selectedMailboxId: string | null;
  setIsManualRefreshing: (action: SetStateAction<boolean>) => void;
};

const EMPTY_MESSAGE_PAGES: ListMessagesPageResult[] = [];

export const useMailboxMessages = ({
  activeMailbox,
  isDemoMode,
  isManualRefreshing,
  isWindowActive,
  messageId,
  queryClient,
  searchQuery,
  selectedMailboxId,
  setIsManualRefreshing,
}: UseMailboxMessagesOptions) => {
  const normalizedQuery = searchQuery.trim();
  const messagesQuery = useInfiniteQuery(
    messagesQueryOptions(
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      !!selectedMailboxId,
    ),
  );
  const messages = messagesQuery.data?.pages ?? EMPTY_MESSAGE_PAGES;
  const hasLoadedMessages = !!messagesQuery.data?.pages.length;
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

  const refreshMessages = async () => {
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
      setIsManualRefreshing(false);
    } catch (error) {
      setIsManualRefreshing(false);
      throw error;
    }
  };

  const refreshSearchResultsIfNeeded = async () => {
    if (!selectedMailboxId || normalizedQuery.length === 0) return;
    await refreshLoadedMessagesPages(
      queryClient,
      selectedMailboxId,
      activeMailbox,
      normalizedQuery,
    );
  };

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
    isManualRefreshing ||
    syncQuery.isFetching ||
    (messagesQuery.isRefetching && !messagesQuery.isFetchingNextPage);
  const isLoadingEmptyMessages =
    !messages.some((page) => page.messages.length > 0) && (messagesQuery.isPending || isRefreshing);

  const loadMoreMessages = () => {
    if (
      !messagesQuery.hasNextPage ||
      messagesQuery.isFetchingNextPage ||
      messagesQuery.isPending ||
      messagesQuery.isError
    ) {
      return;
    }

    void messagesQuery.fetchNextPage();
  };

  return {
    flattenedMessages,
    handleVisibleMessageIdsChange,
    hasMessagePages: !!messagesQuery.data?.pages.length,
    isLoadingEmptyMessages,
    isRefreshing,
    listState: {
      error: messagesQuery.error ?? null,
      hasNextPage: !!messagesQuery.hasNextPage,
      isError: messagesQuery.isError,
      isFetchingNextPage: messagesQuery.isFetchingNextPage,
      isPending: messagesQuery.isPending,
      isRefreshing,
      messages,
    },
    loadMoreMessages,
    messagesPending: messagesQuery.isPending,
    refreshMessages,
    refreshSearchResultsIfNeeded,
    selectedMessage,
  };
};
