import type { QueryClient } from "@tanstack/react-query";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";
import {
  GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS,
  GMAIL_QUERY_STALE_TIME_MS,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
  type ThreadMessagesResult,
} from "../gmail";
import { getThreadQueryKey } from "../thread-query";
import {
  applySyncDeltaToQueryData,
  mergeMessagePreservingLoadedDetails,
  mergeRefreshedMailboxPagesIntoQueryData,
  removeMessagesFromThreadData,
  updateFirstPageHistoryId,
  updateMessageInThreadData,
  type MessagesQueryData,
} from "./data";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  normalizeSearchQuery,
  parsePageToken,
} from "./keys";
import { getCachedMessagesQueries } from "./query-cache";

const fetchMessagesPage = async (
  mailboxId: string,
  mailbox: MailboxCategory,
  pageToken: string | undefined,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  return await rpc.mail.listMessages(
    {
      mailboxId,
      category: mailbox,
      pageToken,
      maxResults: pageToken ? 25 : 50,
      query: normalizeSearchQuery(searchQuery),
    },
    { signal },
  );
};

export const refreshLoadedMessagesPages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const loadedPageCount = Math.max(currentMessages?.pages.length ?? 0, 1);
  const refreshedPages: ListMessagesPageResult[] = [];
  const refreshedPageParams: Array<string | undefined> = [];
  let pageToken: string | undefined;

  for (let pageIndex = 0; pageIndex < loadedPageCount; pageIndex += 1) {
    refreshedPageParams.push(pageToken);
    const refreshedPage = await fetchMessagesPage(
      mailboxId,
      mailbox,
      pageToken,
      searchQuery,
      signal,
    );

    refreshedPages.push(refreshedPage);
    if (!refreshedPage.nextPageToken) break;
    pageToken = refreshedPage.nextPageToken;
  }

  queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, (data) =>
    mergeRefreshedMailboxPagesIntoQueryData(data, refreshedPages, refreshedPageParams),
  );
  await queryPersister.persistQueryByKey(messagesQueryKey, queryClient);
  return refreshedPages[0];
};

export const refreshMessagesFirstPage = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, signal);
};

export const refreshCachedMailboxQueries = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
) => {
  const cachedQueries = getCachedMessagesQueries(queryClient, mailboxId).filter(
    (cachedQuery) => cachedQuery.mailbox === mailbox,
  );

  if (cachedQueries.length === 0) {
    await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox);
    return;
  }

  await Promise.all(
    cachedQueries.map(
      async (cachedQuery) =>
        await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, cachedQuery.searchQuery),
    ),
  );
};

const applyMailboxSyncDelta = async (
  queryClient: QueryClient,
  mailboxId: string,
  messagesQueryKey: ReturnType<typeof getMessagesQueryKey>,
  startHistoryId: string,
  updatedMessages: readonly MessageListItem[],
  removedMessageIds: readonly string[],
  nextHistoryId?: string,
) => {
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const removedMessageThreadIds = new Map<string, string>();

  for (const removedMessageId of removedMessageIds) {
    const removedMessage = currentMessages?.pages
      .flatMap((page) => page.messages)
      .find((message) => message.id === removedMessageId);

    if (removedMessage) {
      removedMessageThreadIds.set(removedMessageId, removedMessage.threadId);
    }
  }

  if (updatedMessages.length > 0 || removedMessageIds.length > 0) {
    queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, (data) =>
      applySyncDeltaToQueryData(data, updatedMessages, removedMessageIds),
    );
  }

  if (nextHistoryId && nextHistoryId !== startHistoryId) {
    queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, (data) =>
      updateFirstPageHistoryId(data, nextHistoryId),
    );
  }

  await queryPersister.persistQueryByKey(messagesQueryKey, queryClient);

  const touchedThreadQueryKeys = new Map<string, ReturnType<typeof getThreadQueryKey>>();

  for (const updatedMessage of updatedMessages) {
    const threadQueryKey = getThreadQueryKey(mailboxId, updatedMessage.threadId);
    touchedThreadQueryKeys.set(threadQueryKey.join("::"), threadQueryKey);
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, updatedMessage.id, (message) =>
        mergeMessagePreservingLoadedDetails(message, updatedMessage),
      ),
    );
  }

  for (const removedMessageId of removedMessageIds) {
    const removedThreadId = removedMessageThreadIds.get(removedMessageId);
    if (!removedThreadId) continue;

    const threadQueryKey = getThreadQueryKey(mailboxId, removedThreadId);
    touchedThreadQueryKeys.set(threadQueryKey.join("::"), threadQueryKey);
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      removeMessagesFromThreadData(currentData, (message) => message.id === removedMessageId),
    );
  }

  for (const threadQueryKey of touchedThreadQueryKeys.values()) {
    await queryPersister.persistQueryByKey(threadQueryKey, queryClient);
  }
};

export const syncMessages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  if (mailbox === "drafts" || normalizeSearchQuery(searchQuery)) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, signal);
  }

  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const startHistoryId = currentMessages?.pages[0]?.historyId;

  if (!currentMessages?.pages.length || !startHistoryId) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, signal);
  }

  const syncDelta = await rpc.mail.getMailboxSyncDelta(
    {
      mailboxId,
      category: mailbox,
      startHistoryId,
    },
    { signal },
  );

  if (syncDelta.requiresFullRefresh) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, signal);
  }

  await applyMailboxSyncDelta(
    queryClient,
    mailboxId,
    messagesQueryKey,
    startHistoryId,
    syncDelta.updatedMessages,
    syncDelta.removedMessageIds,
    syncDelta.historyId,
  );

  return (
    queryClient.getQueryData<MessagesQueryData>(messagesQueryKey)?.pages[0] ??
    currentMessages.pages[0]
  );
};

export const messagesQueryOptions = (
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  enabled = true,
) =>
  infiniteQueryOptions({
    queryKey: getMessagesQueryKey(mailboxId, mailbox, searchQuery),
    queryFn: (ctx: { pageParam: unknown; signal: AbortSignal }) => {
      return fetchMessagesPage(
        mailboxId,
        mailbox,
        parsePageToken(ctx.pageParam),
        searchQuery,
        ctx.signal,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ListMessagesPageResult) => lastPage.nextPageToken ?? undefined,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    enabled,
    retry: 3,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export const liveSyncQueryOptions = (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  enabled = true,
) =>
  queryOptions({
    queryKey: getLiveSyncQueryKey(mailboxId, mailbox, searchQuery),
    queryFn: ({ signal }) => syncMessages(queryClient, mailboxId, mailbox, searchQuery, signal),
    enabled,
    initialData: () =>
      queryClient.getQueryData<MessagesQueryData>(
        getMessagesQueryKey(mailboxId, mailbox, searchQuery),
      )?.pages[0],
    persister: undefined,
    retry: 3,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
