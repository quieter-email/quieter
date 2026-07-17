"use client";

import type { RouterOutputs } from "@quieter/orpc";
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
import { useMailboxLiveSync } from "~/lib/gmail/use-gmail-live-sync";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import { isMailboxScopeRepairRequiredError } from "~/lib/orpc-errors";

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

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];

const markMailboxNeedsReconnectInCache = (queryClient: QueryClient, error: unknown) => {
  if (!isMailboxScopeRepairRequiredError(error)) {
    return;
  }

  const queryKey = getMailboxesQueryKey();
  const mailboxId = error.data.mailboxId;
  queryClient.setQueryData<MailboxesQueryData>(queryKey, (data) => {
    if (!data) {
      return data;
    }

    let didUpdate = false;
    const groups = data.groups.map((group) => {
      let didUpdateGroup = false;
      const mailboxes = group.mailboxes.map((mailbox) => {
        if (mailbox.id !== mailboxId || mailbox.connectionStatus === "needs_reconnect") {
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
    () => typeof document !== "undefined" && document.visibilityState === "visible",
  );

  useEffect(() => {
    const updateWindowActivity = () => {
      const nextIsWindowActive = document.visibilityState === "visible" && document.hasFocus();
      setIsWindowActive((current) =>
        current === nextIsWindowActive ? current : nextIsWindowActive,
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
      !!selectedMailboxId,
    ),
  );
  const messages = messagesData?.pages ?? EMPTY_MESSAGE_PAGES;
  const hasLoadedMessages = !!messagesData?.pages.length;
  const isLiveSyncEnabled =
    !!selectedMailboxId &&
    !isDemoMode &&
    !isManagedDemoMode &&
    activeMailbox !== "drafts" &&
    normalizedQuery.length === 0 &&
    mailboxProvider !== "api" &&
    isWindowActive &&
    hasLoadedMessages &&
    !isManualRefreshing;
  const { error: syncError, isFetching: isSyncFetching } = useQuery(
    liveSyncQueryOptions(
      queryClient,
      selectedMailboxId ?? "",
      activeMailbox,
      normalizedQuery,
      isLiveSyncEnabled,
    ),
  );
  useMailboxLiveSync({
    enabled: isLiveSyncEnabled && mailboxProvider === "gmail",
    mailboxId: selectedMailboxId ?? "",
    queryClient,
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
  const {
    data: selectedThreadData,
    error: selectedThreadError,
    isPending: isSelectedThreadPending,
  } = useQuery(
    getThreadWithDetailsOptions(selectedMailboxId ?? "", threadId ?? "", shouldLoadSelectedThread),
  );

  useEffect(() => {
    const reconnectError = [messagesError, syncError, selectedThreadError].find(
      isMailboxScopeRepairRequiredError,
    );
    markMailboxNeedsReconnectInCache(queryClient, reconnectError);
  }, [messagesError, queryClient, selectedThreadError, syncError]);

  const refreshMessages = useCallback(async () => {
    if (!selectedMailboxId) {
      return;
    }

    const liveSyncQueryKey = getLiveSyncQueryKey(selectedMailboxId, activeMailbox, normalizedQuery);
    const messagesQueryKey = getMessagesQueryKey(selectedMailboxId, activeMailbox, normalizedQuery);

    await queryClient.cancelQueries({ queryKey: liveSyncQueryKey });
    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setIsManualRefreshing(true);
    const syncError = await syncMessages(
      queryClient,
      selectedMailboxId,
      activeMailbox,
      normalizedQuery,
    )
      .then(() => null)
      .catch((error: unknown) => error);
    setIsManualRefreshing(false);

    if (syncError) {
      markMailboxNeedsReconnectInCache(queryClient, syncError);
      throw syncError;
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

  const selectedMessage =
    cachedSelectedMessage ??
    selectedThreadData?.messages.find((message) => message.id === messageId) ??
    null;

  const isRefreshing =
    isManualRefreshing || isSyncFetching || (isRefetching && !isFetchingNextPage);
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
    hasMessagePages: !!messagesData?.pages.length,
    isLoadingEmptyMessages,
    isRefreshing,
    listState,
    loadMoreMessages,
    messagesPending: isPending || (shouldLoadSelectedThread && isSelectedThreadPending),
    refreshMessages,
    refreshSearchResultsIfNeeded,
    selectedMessage,
  };
};
