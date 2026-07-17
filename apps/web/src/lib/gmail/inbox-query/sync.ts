import type { QueryClient, QueryPersister } from "@tanstack/react-query";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { listManagedDemoMessages } from "~/lib/managed-mail/demo-managed-mail";
import { rpc } from "~/lib/orpc";
import { shouldRetryOrpcError } from "~/lib/orpc-errors";
import { persistQueryByKey, queryPersister } from "~/lib/query-persister";
import { isManagedSandboxMailboxId, isSandboxMailboxId } from "~/lib/sandbox-mailbox";
import { LANDING_DEMO_MAILBOX_ID, listDemoMessages } from "../demo-mail";
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
  mergeRefreshedMailboxPagesIntoQueryData,
  updateFirstPageHistoryId,
  upsertMessageInThreadData,
  type MessagesQueryData,
} from "./data";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  normalizeSearchQuery,
  parsePageToken,
} from "./keys";
import { getCachedMessagesQueries } from "./query-cache";

// Keep full-refresh fallbacks bounded after an infinite query restores a deep persisted list.
const GMAIL_MAILBOX_REFRESH_PAGE_LIMIT = 3;

type RefreshLoadedMessagesPagesOptions = {
  maxPageCount?: number;
  preserveUnrefreshedPages?: boolean;
  signal?: AbortSignal;
};

type MessagesQueryPersister = QueryPersister<
  ListMessagesPageResult,
  ReturnType<typeof getMessagesQueryKey>,
  string | undefined
>;

const messagesQueryPersister = queryPersister.persisterFn as unknown as MessagesQueryPersister;

const fetchMessagesPage = async (
  mailboxId: string,
  mailbox: MailboxCategory,
  pageToken: string | undefined,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  if (isManagedSandboxMailboxId(mailboxId)) {
    return listManagedDemoMessages({
      category: mailbox,
      pageToken,
      maxResults: 15,
      query: normalizeSearchQuery(searchQuery),
    });
  }

  if (isSandboxMailboxId(mailboxId)) {
    return listDemoMessages({
      mailboxId,
      category: mailbox,
      pageToken,
      maxResults: 15,
      query: normalizeSearchQuery(searchQuery),
    });
  }

  return await rpc.mail.listThreads(
    {
      mailboxId,
      category: mailbox,
      pageToken,
      maxResults: 15,
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
  options: RefreshLoadedMessagesPagesOptions = {},
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const loadedPageCount = Math.max(currentMessages?.pages.length ?? 0, 1);
  const maxPageCount = Math.max(1, options.maxPageCount ?? GMAIL_MAILBOX_REFRESH_PAGE_LIMIT);
  const refreshedPageCount = Math.min(loadedPageCount, maxPageCount);
  const refreshedPages: ListMessagesPageResult[] = [];
  const refreshedPageParams: Array<string | undefined> = [];

  const refreshNextPage = async (pageIndex: number, pageToken: string | undefined) => {
    if (pageIndex >= refreshedPageCount) return;

    refreshedPageParams.push(pageToken);
    const refreshedPage = await fetchMessagesPage(
      mailboxId,
      mailbox,
      pageToken,
      searchQuery,
      options.signal,
    );

    refreshedPages.push(refreshedPage);
    if (!refreshedPage.nextPageToken) return;
    await refreshNextPage(pageIndex + 1, refreshedPage.nextPageToken);
  };

  await refreshNextPage(0, undefined);

  queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, (data) =>
    mergeRefreshedMailboxPagesIntoQueryData(data, refreshedPages, refreshedPageParams, {
      preserveUnrefreshedPages:
        options.preserveUnrefreshedPages ?? refreshedPageCount < loadedPageCount,
    }),
  );
  await persistQueryByKey(messagesQueryKey, queryClient);
  return refreshedPages[0];
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

export const applyMailboxSyncDelta = async (
  queryClient: QueryClient,
  mailboxId: string,
  messagesQueryKey: ReturnType<typeof getMessagesQueryKey>,
  startHistoryId: string,
  updatedMessages: readonly MessageListItem[],
  removedMessageIds: readonly string[],
  nextHistoryId?: string,
) => {
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

  await persistQueryByKey(messagesQueryKey, queryClient);

  const touchedThreadQueryKeys = new Map<string, ReturnType<typeof getThreadQueryKey>>();

  for (const updatedMessage of updatedMessages) {
    const threadQueryKey = getThreadQueryKey(mailboxId, updatedMessage.threadId);
    touchedThreadQueryKeys.set(threadQueryKey.join("::"), threadQueryKey);
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      upsertMessageInThreadData(currentData, updatedMessage),
    );
  }

  await Promise.all(
    Array.from(touchedThreadQueryKeys.values(), (threadQueryKey) =>
      persistQueryByKey(threadQueryKey, queryClient),
    ),
  );
};

export const syncMessages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  if (isSandboxMailboxId(mailboxId)) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, {
      signal,
    });
  }

  if (mailbox === "drafts" || normalizeSearchQuery(searchQuery)) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, {
      signal,
    });
  }

  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const startHistoryId = currentMessages?.pages[0]?.historyId;

  if (!currentMessages?.pages.length || !startHistoryId) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, {
      signal,
    });
  }

  const syncDelta = await rpc.mail.syncMailbox(
    {
      mailboxId,
      category: mailbox,
      startHistoryId,
    },
    { signal },
  );

  if (syncDelta.requiresFullRefresh) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, {
      signal,
    });
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

  if (syncDelta.refreshFirstPage) {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, {
      maxPageCount: 1,
      preserveUnrefreshedPages: true,
      signal,
    });
  }

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
    ...(mailboxId === LANDING_DEMO_MAILBOX_ID
      ? {
          initialData: {
            pageParams: [undefined],
            pages: [
              listDemoMessages({
                mailboxId,
                category: mailbox,
                maxResults: 50,
                query: normalizeSearchQuery(searchQuery),
              }),
            ],
          },
        }
      : {}),
    getNextPageParam: (lastPage: ListMessagesPageResult) => lastPage.nextPageToken ?? undefined,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    gcTime: 1000 * 60 * 30,
    enabled,
    ...(normalizeSearchQuery(searchQuery) ? {} : { persister: messagesQueryPersister }),
    retry: shouldRetryOrpcError,
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
    retry: shouldRetryOrpcError,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
