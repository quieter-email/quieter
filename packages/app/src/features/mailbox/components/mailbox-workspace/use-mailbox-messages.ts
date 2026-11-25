"use client";

import type {
  ListMessagesPageResult,
  MailboxCategory,
} from "@quieter/app/lib/mail";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
  syncMessages,
} from "@quieter/app/lib/mail/inbox-query/index";
import { getProvisionalMessagesData } from "@quieter/app/lib/mail/inbox-query/provisional";
import { getThreadWithDetailsOptions } from "@quieter/app/lib/mail/thread-query";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { isMailboxScopeRepairRequiredError } from "@quieter/app/lib/orpc-errors";
import type { RouterOutputs } from "@quieter/orpc";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type UseMailboxMessagesOptions = {
  activeMailbox: MailboxCategory;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  mailboxProvider: "api" | "gmail" | "managed";
  messageId?: string;
  threadId?: string;
  queryClient: QueryClient;
  searchQuery: string;
  selectedMailboxId: string | null;
};

const EMPTY_MESSAGE_PAGES: ListMessagesPageResult[] = [];

const hasLoadedMessagePages = (
  data: { pages: readonly unknown[] } | undefined
) => data !== undefined && data.pages.length > 0;

const getCachedSelectedMessage = (
  activeMailbox: MailboxCategory,
  messageId: string | undefined,
  messages: readonly ListMessagesPageResult[]
) =>
  activeMailbox !== "drafts" && messageId
    ? messages
        .flatMap((page) => page.messages)
        .find((message) => message.id === messageId)
    : undefined;

const shouldLoadSelectedThread = ({
  activeMailbox,
  cachedSelectedMessage,
  messageId,
  selectedMailboxId,
  threadId,
}: {
  activeMailbox: MailboxCategory;
  cachedSelectedMessage: ListMessagesPageResult["messages"][number] | undefined;
  messageId: string | undefined;
  selectedMailboxId: string | null;
  threadId: string | undefined;
}) =>
  activeMailbox !== "drafts" &&
  !!selectedMailboxId &&
  !!messageId &&
  !!threadId &&
  cachedSelectedMessage === undefined;

const getSelectedMessage = ({
  cachedSelectedMessage,
  messageId,
  selectedThreadData,
}: {
  cachedSelectedMessage: ListMessagesPageResult["messages"][number] | undefined;
  messageId: string | undefined;
  selectedThreadData:
    | { messages: ListMessagesPageResult["messages"][number][] }
    | undefined;
}) =>
  cachedSelectedMessage ??
  selectedThreadData?.messages.find((message) => message.id === messageId) ??
  null;

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];

export const markMailboxNeedsReconnectInCache = (
  queryClient: QueryClient,
  error: unknown
) => {
  if (!isMailboxScopeRepairRequiredError(error)) {
    return;
  }

  const queryKey = getMailboxesQueryKey();
  const { mailboxId } = error.data;
  queryClient.setQueryData<MailboxesQueryData>(queryKey, (data) => {
    if (!data) {
      return data;
    }

    let didUpdate = false;
    const groups = data.groups.map((group) => {
      let didUpdateGroup = false;
      const mailboxes = group.mailboxes.map((mailbox) => {
        if (
          mailbox.id !== mailboxId ||
          mailbox.connectionStatus === "needs_reconnect"
        ) {
          return mailbox;
        }

        didUpdate = true;
        didUpdateGroup = true;
        return { ...mailbox, connectionStatus: "needs_reconnect" as const };
      });

      return didUpdateGroup ? { ...group, mailboxes } : group;
    });

    return didUpdate ? { ...data, groups } : data;
  });
  void queryClient.invalidateQueries({ queryKey });
};

export const useMailboxMessages = ({
  activeMailbox,
  isDemoMode,
  isManagedDemoMode,
  mailboxProvider,
  messageId,
  threadId,
  queryClient,
  searchQuery,
  selectedMailboxId,
}: UseMailboxMessagesOptions) => {
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const isFetchingNextPageRef = useRef(false);
  const normalizedQuery = searchQuery.trim();
  const ownsLiveSync =
    !!selectedMailboxId &&
    !isDemoMode &&
    !isManagedDemoMode &&
    activeMailbox !== "drafts" &&
    normalizedQuery.length === 0 &&
    mailboxProvider !== "api";
  const provisionalData = useMemo(
    () =>
      getProvisionalMessagesData(
        queryClient,
        selectedMailboxId ?? "",
        activeMailbox,
        normalizedQuery
      ),
    [activeMailbox, normalizedQuery, queryClient, selectedMailboxId]
  );
  const {
    data: messagesData,
    error: messagesError,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isPending,
    isPlaceholderData,
    isRefetching,
  } = useInfiniteQuery({
    ...messagesQueryOptions(
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      !!selectedMailboxId,
      ownsLiveSync
    ),
    ...(provisionalData === undefined
      ? {}
      : { placeholderData: provisionalData }),
  });
  const messages = messagesData?.pages ?? EMPTY_MESSAGE_PAGES;
  const hasLoadedMessages = hasLoadedMessagePages(messagesData);
  const isLiveSyncEnabled =
    ownsLiveSync &&
    hasLoadedMessages &&
    !isManualRefreshing &&
    !isPlaceholderData;
  const { error: syncError, isFetching: isSyncFetching } = useQuery(
    liveSyncQueryOptions(
      queryClient,
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      isLiveSyncEnabled
    )
  );

  const flattenedMessages = useMemo(
    () => messages.flatMap((page) => page.messages),
    [messages]
  );
  const cachedSelectedMessage = getCachedSelectedMessage(
    activeMailbox,
    messageId,
    messages
  );
  const shouldLoadThread = shouldLoadSelectedThread({
    activeMailbox,
    cachedSelectedMessage,
    messageId,
    selectedMailboxId,
    threadId,
  });
  const {
    data: selectedThreadData,
    error: selectedThreadError,
    isPending: isSelectedThreadPending,
    refetch: refreshSelectedThread,
  } = useQuery(
    getThreadWithDetailsOptions(
      selectedMailboxId ?? "",
      threadId ?? "",
      shouldLoadThread
    )
  );

  useEffect(() => {
    const reconnectError = [messagesError, syncError, selectedThreadError].find(
      isMailboxScopeRepairRequiredError
    );
    markMailboxNeedsReconnectInCache(queryClient, reconnectError);
  }, [messagesError, queryClient, selectedThreadError, syncError]);

  const refreshMessages = useCallback(async () => {
    if (!selectedMailboxId) {
      return;
    }

    const liveSyncQueryKey = getLiveSyncQueryKey(
      selectedMailboxId,
      activeMailbox,
      normalizedQuery
    );
    const messagesQueryKey = getMessagesQueryKey(
      selectedMailboxId,
      activeMailbox,
      normalizedQuery
    );

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setIsManualRefreshing(true);
    const refreshError = await syncMessages(
      queryClient,
      selectedMailboxId,
      activeMailbox,
      normalizedQuery
    )
      .then(() => null)
      .catch((error: unknown) => error)
      .finally(() => {
        setIsManualRefreshing(false);
      });

    if (refreshError !== null && refreshError !== undefined) {
      markMailboxNeedsReconnectInCache(queryClient, refreshError);
      throw refreshError instanceof Error
        ? refreshError
        : new Error("Mailbox synchronization failed.", { cause: refreshError });
    }
  }, [activeMailbox, normalizedQuery, queryClient, selectedMailboxId]);

  const refreshSearchResultsIfNeeded = useCallback(async () => {
    if (!selectedMailboxId || normalizedQuery.length === 0) {
      return;
    }
    await refreshLoadedMessagesPages(
      queryClient,
      selectedMailboxId,
      activeMailbox,
      normalizedQuery
    );
  }, [activeMailbox, normalizedQuery, queryClient, selectedMailboxId]);

  const selectedMessage = getSelectedMessage({
    cachedSelectedMessage,
    messageId,
    selectedThreadData,
  });

  const isRefreshing =
    isManualRefreshing ||
    isPlaceholderData ||
    isSyncFetching ||
    (isRefetching && !isFetchingNextPage);
  const isLoadingEmptyMessages = !hasLoadedMessages && isPending;

  const loadMoreMessages = useCallback(() => {
    if (
      isFetchingNextPageRef.current ||
      !hasNextPage ||
      isFetchingNextPage ||
      isPending ||
      isError
    ) {
      return;
    }

    isFetchingNextPageRef.current = true;
    void (async () => {
      try {
        await fetchNextPage();
      } finally {
        isFetchingNextPageRef.current = false;
      }
    })();
  }, [fetchNextPage, hasNextPage, isError, isFetchingNextPage, isPending]);

  const listState = useMemo(
    () => ({
      error: messagesError ?? null,
      hasNextPage,
      isError,
      isFetchingNextPage,
      isPending,
      isRefreshing,
      messages,
    }),
    [
      hasNextPage,
      isError,
      isFetchingNextPage,
      isPending,
      isRefreshing,
      messages,
      messagesError,
    ]
  );

  return {
    fetchNextPage,
    flattenedMessages,
    hasMessagePages:
      messagesData !== undefined && messagesData.pages.length > 0,
    isLoadingEmptyMessages,
    isRefreshing,
    listState,
    loadMoreMessages,
    messagesPending: isPending || (shouldLoadThread && isSelectedThreadPending),
    refreshMessages,
    refreshSearchResultsIfNeeded,
    refreshSelectedThread,
    selectedMessage,
    selectedThreadError,
    selectedThreadMessages: selectedThreadData?.messages,
    syncError,
  };
};
