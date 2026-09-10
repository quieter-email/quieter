"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getMessagesQueryKey,
  messagesQueryOptions,
  refreshLoadedMessagesPages,
} from "#/lib/gmail/inbox-query";
import { getThreadWithDetailsOptions } from "#/lib/gmail/thread-query";
import type { ListMessagesPageResult, MailboxCategory } from "#/lib/mail";
import { useWarmMailThreads } from "#/lib/mail-sync/hooks";
import { MailSyncSession } from "#/lib/mail-sync/session";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { isMailboxScopeRepairRequiredError } from "#/lib/orpc-errors";
import { isSandboxMailboxId } from "#/lib/sandbox-mailbox";

type UseMailboxMessagesOptions = {
  activeMailbox: MailboxCategory;
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

export const useMailboxMessages = ({
  activeMailbox,
  messageId,
  threadId,
  queryClient,
  searchQuery,
  selectedMailboxId,
}: UseMailboxMessagesOptions) => {
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
      !!selectedMailboxId
    )
  );
  const messages = messagesData?.pages ?? EMPTY_MESSAGE_PAGES;
  const hasLoadedMessages = hasLoadedMessagePages(messagesData);
  const flattenedMessages = useMemo(
    () => messages.flatMap((page) => page.messages),
    [messages]
  );
  useWarmMailThreads(
    selectedMailboxId ?? "",
    flattenedMessages.map((message) => message.threadId),
    2
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
    const reconnectError = [messagesError, selectedThreadError].find(
      isMailboxScopeRepairRequiredError
    );
    markMailboxNeedsReconnectInCache(queryClient, reconnectError);
  }, [messagesError, queryClient, selectedThreadError]);

  const refreshMessages = useCallback(async () => {
    if (!selectedMailboxId) {
      return;
    }

    const messagesQueryKey = getMessagesQueryKey(
      selectedMailboxId,
      activeMailbox,
      normalizedQuery
    );

    await queryClient.cancelQueries({ queryKey: messagesQueryKey });

    setIsManualRefreshing(true);
    const refreshError = await (async () => {
      if (
        !isSandboxMailboxId(selectedMailboxId) &&
        !selectedMailboxId.startsWith("api:")
      ) {
        const sync = await MailSyncSession.waitForMailbox(selectedMailboxId);
        await sync.refresh(selectedMailboxId);
      }
      await refreshLoadedMessagesPages(
        queryClient,
        selectedMailboxId,
        activeMailbox,
        normalizedQuery
      );
    })()
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
    isManualRefreshing || (isRefetching && !isFetchingNextPage);
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
