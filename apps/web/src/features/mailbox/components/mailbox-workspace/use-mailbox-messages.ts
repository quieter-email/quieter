"use client";

import { type QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ListMessagesPageResult, type MailboxCategory } from "~/lib/gmail/gmail";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
  syncMessages,
} from "~/lib/gmail/inbox-query";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { useGmailLiveSync } from "~/lib/gmail/use-gmail-live-sync";
import { useVisibleMessageRefresh } from "./use-visible-message-refresh";

type UseMailboxMessagesOptions = {
  activeMailbox: MailboxCategory;
  isDemoMode: boolean;
  mailboxProvider: "gmail" | "managed";
  messageId?: string;
  threadId?: string;
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
  mailboxProvider,
  messageId,
  threadId,
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
  useGmailLiveSync({
    enabled: isLiveSyncEnabled && mailboxProvider === "gmail",
    mailbox: activeMailbox,
    mailboxId: selectedMailboxId ?? "",
    queryClient,
    searchQuery: normalizedQuery,
  });
  const flattenedMessages = useMemo(() => messages.flatMap((page) => page.messages), [messages]);
  const cachedSelectedMessage =
    activeMailbox !== "drafts" && messageId
      ? flattenedMessages.find((message) => message.id === messageId)
      : undefined;
  const shouldLoadSelectedThread =
    activeMailbox !== "drafts" &&
    !!selectedMailboxId &&
    !!messageId &&
    !!threadId &&
    !cachedSelectedMessage;
  const selectedThreadQuery = useQuery(
    getThreadWithDetailsOptions(selectedMailboxId ?? "", threadId ?? "", shouldLoadSelectedThread),
  );

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

  const selectedMessage =
    cachedSelectedMessage ??
    selectedThreadQuery.data?.messages.find((message) => message.id === messageId) ??
    null;

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
    messagesPending: isPending || (shouldLoadSelectedThread && selectedThreadQuery.isPending),
    refreshMessages,
    refreshSearchResultsIfNeeded,
    selectedMessage,
  };
};
