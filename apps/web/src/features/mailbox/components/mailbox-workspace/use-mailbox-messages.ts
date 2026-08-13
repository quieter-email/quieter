"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ListMessagesPageResult,
  MailboxCategory,
} from "#/lib/gmail/gmail";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  liveSyncQueryOptions,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
  syncMessages,
} from "#/lib/gmail/inbox-query";
import { getThreadWithDetailsOptions } from "#/lib/gmail/thread-query";
import { useMailboxLiveSync } from "#/lib/gmail/use-gmail-live-sync";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { isMailboxScopeRepairRequiredError } from "#/lib/orpc-errors";

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

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

const hasLoadedMessagePages = (
  data: { pages: readonly unknown[] } | undefined
) => data !== undefined && data.pages.length > 0;

const canUseLiveSync = ({
  activeMailbox,
  hasLoadedMessages,
  isDemoMode,
  isManagedDemoMode,
  isManualRefreshing,
  isWindowActive,
  mailboxProvider,
  normalizedQuery,
  selectedMailboxId,
}: {
  activeMailbox: MailboxCategory;
  hasLoadedMessages: boolean;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  isManualRefreshing: boolean;
  isWindowActive: boolean;
  mailboxProvider: "api" | "gmail" | "managed";
  normalizedQuery: string;
  selectedMailboxId: string | null;
}) =>
  hasText(selectedMailboxId) &&
  !isDemoMode &&
  !isManagedDemoMode &&
  activeMailbox !== "drafts" &&
  normalizedQuery.length === 0 &&
  mailboxProvider !== "api" &&
  isWindowActive &&
  hasLoadedMessages &&
  !isManualRefreshing;

const getCachedSelectedMessage = (
  activeMailbox: MailboxCategory,
  messageId: string | undefined,
  messages: readonly ListMessagesPageResult[]
) =>
  activeMailbox !== "drafts" && hasText(messageId)
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
  hasText(selectedMailboxId) &&
  hasText(messageId) &&
  hasText(threadId) &&
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

const getIsRefreshing = (
  isManualRefreshing: boolean,
  isSyncFetching: boolean,
  isRefetching: boolean,
  isFetchingNextPage: boolean
) =>
  isManualRefreshing || isSyncFetching || (isRefetching && !isFetchingNextPage);

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];

const markMailboxNeedsReconnectInCache = (
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

const useWindowActive = () => {
  const [isWindowActive, setIsWindowActive] = useState(
    () =>
      typeof document !== "undefined" && document.visibilityState === "visible"
  );

  useEffect(() => {
    const updateWindowActivity = () => {
      const nextIsWindowActive =
        document.visibilityState === "visible" && document.hasFocus();
      setIsWindowActive((current) =>
        current === nextIsWindowActive ? current : nextIsWindowActive
      );
    };

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
  isManagedDemoMode,
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
  const {
    data: messagesData,
    error: messagesError,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isPending,
    isRefetching,
  } = useInfiniteQuery(
    messagesQueryOptions(
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      hasText(selectedMailboxId)
    )
  );
  const messages = messagesData?.pages ?? EMPTY_MESSAGE_PAGES;
  const hasLoadedMessages = hasLoadedMessagePages(messagesData);
  const isLiveSyncEnabled = canUseLiveSync({
    activeMailbox,
    hasLoadedMessages,
    isDemoMode,
    isManagedDemoMode,
    isManualRefreshing,
    isWindowActive,
    mailboxProvider,
    normalizedQuery,
    selectedMailboxId,
  });
  const { error: syncError, isFetching: isSyncFetching } = useQuery(
    liveSyncQueryOptions(
      queryClient,
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      isLiveSyncEnabled
    )
  );
  useMailboxLiveSync({
    enabled: isLiveSyncEnabled && mailboxProvider === "gmail",
    mailboxId: selectedMailboxId ?? "",
    queryClient,
  });
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
    if (!hasText(selectedMailboxId)) {
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
    if (!hasText(selectedMailboxId) || normalizedQuery.length === 0) {
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

  const isRefreshing = getIsRefreshing(
    isManualRefreshing,
    isSyncFetching,
    isRefetching,
    isFetchingNextPage
  );
  const isLoadingEmptyMessages = !hasLoadedMessages && isPending;

  const loadMoreMessages = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || isPending || isError) {
      return;
    }

    void fetchNextPage();
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
    selectedMessage,
  };
};
