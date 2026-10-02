import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { QueryClient, QueryPersister } from "@tanstack/react-query";

import {
  GMAIL_QUERY_STALE_TIME_MS,
  hasRenderableMessageBody,
} from "#/lib/mail";
import type {
  ListMessagesPageResult,
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/mail";
import { updateMailQueryFromServer } from "#/lib/mail-mutations";
import { listManagedDemoMessages } from "#/lib/managed-mail/demo-managed-mail";
import { rpc } from "#/lib/orpc";
import { shouldRetryOrpcError } from "#/lib/orpc-errors";
import { persistQueryByKey, queryPersister } from "#/lib/query-persister";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "#/lib/sandbox-mailbox";

import {
  LANDING_DEMO_MAILBOX_ID,
  listDemoMessages,
} from "../../gmail/demo-mail";
import { getThreadQueryKey } from "../thread-query";
import {
  applySyncDeltaToQueryData,
  mergeRefreshedMailboxPagesIntoQueryData,
  updateFirstPageHistoryId,
  upsertMessageInThreadData,
} from "./data";
import type { MessagesQueryData } from "./data";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  normalizeSearchQuery,
  parsePageToken,
} from "./keys";
import { getCachedMessagesQueries } from "./query-cache";

// Keep full-refresh fallbacks bounded after an infinite query restores a deep persisted list.
const GMAIL_MAILBOX_REFRESH_PAGE_LIMIT = 3;

type MessagesQueryKey = ReturnType<typeof getMessagesQueryKey>;

const messagesQueryPersister: QueryPersister<
  ListMessagesPageResult,
  MessagesQueryKey,
  string | undefined
> =
  // The persister's generic page-param signature is broader than the
  // infinite-query signature, but it is the same runtime function.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  queryPersister.persisterFn as unknown as QueryPersister<
    ListMessagesPageResult,
    MessagesQueryKey,
    string | undefined
  >;

type RefreshLoadedMessagesPagesOptions = {
  maxPageCount?: number;
  preserveUnrefreshedPages?: boolean;
  signal?: AbortSignal;
  preserveHistoryId?: string;
  refreshThreads?: boolean;
};

const fetchMessagesPage = async (
  mailboxId: string,
  mailbox: MailboxCategory,
  pageToken: string | undefined,
  searchQuery?: string | null,
  signal?: AbortSignal
) => {
  if (isManagedSandboxMailboxId(mailboxId)) {
    return listManagedDemoMessages({
      category: mailbox,
      maxResults: 15,
      pageToken,
      query: normalizeSearchQuery(searchQuery),
    });
  }

  if (isSandboxMailboxId(mailboxId)) {
    return listDemoMessages({
      category: mailbox,
      mailboxId,
      maxResults: 15,
      pageToken,
      query: normalizeSearchQuery(searchQuery),
    });
  }

  return await rpc.mail.listThreads(
    {
      category: mailbox,
      mailboxId,
      maxResults: 15,
      pageToken,
      query: normalizeSearchQuery(searchQuery),
    },
    { signal }
  );
};

export const refreshLoadedMessagesPages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  options: RefreshLoadedMessagesPagesOptions = {}
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const currentMessages =
    queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const loadedPageCount = Math.max(currentMessages?.pages.length ?? 0, 1);
  const maxPageCount = Math.max(
    1,
    options.maxPageCount ?? GMAIL_MAILBOX_REFRESH_PAGE_LIMIT
  );
  const refreshedPageCount = Math.min(loadedPageCount, maxPageCount);
  const refreshedPages: ListMessagesPageResult[] = [];
  const refreshedPageParams: (string | undefined)[] = [];

  const refreshNextPage = async (pageIndex: number, pageToken?: string) => {
    if (pageIndex >= refreshedPageCount) {
      return;
    }

    refreshedPageParams.push(pageToken);
    const refreshedPage = await fetchMessagesPage(
      mailboxId,
      mailbox,
      pageToken,
      searchQuery,
      options.signal
    );

    refreshedPages.push(refreshedPage);
    if (!refreshedPage.nextPageToken) {
      return;
    }
    await refreshNextPage(pageIndex + 1, refreshedPage.nextPageToken);
  };

  await refreshNextPage(0);
  options.signal?.throwIfAborted();
  if (options.refreshThreads === true) {
    await queryClient.invalidateQueries(
      {
        predicate: ({ queryKey }) =>
          queryKey[0] === "message-thread" && queryKey[2] === mailboxId,
      },
      { cancelRefetch: true }
    );
    options.signal?.throwIfAborted();
  }

  updateMailQueryFromServer<MessagesQueryData>(
    queryClient,
    messagesQueryKey,
    (data) =>
      mergeRefreshedMailboxPagesIntoQueryData(
        data,
        options.preserveHistoryId === undefined
          ? refreshedPages
          : refreshedPages.map((page, index) =>
              index === 0
                ? { ...page, historyId: options.preserveHistoryId }
                : page
            ),
        refreshedPageParams,
        {
          preserveUnrefreshedPages:
            options.preserveUnrefreshedPages ??
            refreshedPageCount < loadedPageCount,
        }
      )
  );
  await persistQueryByKey(messagesQueryKey, queryClient);
  return refreshedPages[0];
};

export const refreshCachedMailboxQueries = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory
) => {
  const cachedQueries = getCachedMessagesQueries(queryClient, mailboxId).filter(
    (cachedQuery) => cachedQuery.mailbox === mailbox
  );

  if (cachedQueries.length === 0) {
    await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox);
    return;
  }

  await Promise.all(
    cachedQueries.map(
      async (cachedQuery) =>
        await refreshLoadedMessagesPages(
          queryClient,
          mailboxId,
          mailbox,
          cachedQuery.searchQuery
        )
    )
  );
};

export const applyMailboxSyncDelta = async (
  queryClient: QueryClient,
  mailboxId: string,
  messagesQueryKey: ReturnType<typeof getMessagesQueryKey>,
  updatedMessages: readonly MessageListItem[],
  removedMessageIds: readonly string[],
  signal?: AbortSignal,
  refreshThreadIds: readonly string[] = []
) => {
  signal?.throwIfAborted();
  const threadsNeedingRefresh = new Set<string>();
  for (const [, thread] of queryClient.getQueriesData<ThreadMessagesResult>({
    predicate: ({ queryKey }) =>
      queryKey[0] === "message-thread" && queryKey[2] === mailboxId,
  })) {
    if (
      thread !== undefined &&
      (refreshThreadIds.includes(thread.threadId) ||
        thread.messages.some((message) =>
          removedMessageIds.includes(message.id)
        ))
    ) {
      threadsNeedingRefresh.add(thread.threadId);
    }
  }
  if (updatedMessages.length > 0 || removedMessageIds.length > 0) {
    updateMailQueryFromServer<MessagesQueryData>(
      queryClient,
      messagesQueryKey,
      (data) =>
        applySyncDeltaToQueryData(data, updatedMessages, removedMessageIds)
    );
  }

  await persistQueryByKey(messagesQueryKey, queryClient);
  signal?.throwIfAborted();

  const touchedThreadQueryKeys = new Map<
    string,
    ReturnType<typeof getThreadQueryKey>
  >();

  for (const updatedMessage of updatedMessages) {
    const threadQueryKey = getThreadQueryKey(
      mailboxId,
      updatedMessage.threadId
    );
    const thread =
      queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey);
    if (
      thread !== undefined &&
      !thread.messages.some(
        (message) =>
          message.id === updatedMessage.id && hasRenderableMessageBody(message)
      ) &&
      !hasRenderableMessageBody(updatedMessage)
    ) {
      threadsNeedingRefresh.add(updatedMessage.threadId);
    }
    touchedThreadQueryKeys.set(threadQueryKey.join("::"), threadQueryKey);
    updateMailQueryFromServer(
      queryClient,
      threadQueryKey,
      (currentData: ThreadMessagesResult | undefined) =>
        upsertMessageInThreadData(currentData, updatedMessage)
    );
  }

  await Promise.all(
    Array.from(touchedThreadQueryKeys.values(), async (threadQueryKey) => {
      await persistQueryByKey(threadQueryKey, queryClient);
    })
  );
  signal?.throwIfAborted();
  await Promise.all(
    [...threadsNeedingRefresh].map(async (threadId) => {
      await queryClient.invalidateQueries(
        { exact: true, queryKey: getThreadQueryKey(mailboxId, threadId) },
        { cancelRefetch: true }
      );
    })
  );
};

export const syncMessages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal
) => {
  if (isSandboxMailboxId(mailboxId)) {
    return await refreshLoadedMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        signal,
      }
    );
  }

  if (mailbox === "drafts" || normalizeSearchQuery(searchQuery)) {
    return await refreshLoadedMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        signal,
      }
    );
  }

  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const currentMessages =
    queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const startHistoryId = currentMessages?.pages[0]?.historyId;
  if (
    currentMessages === undefined ||
    currentMessages.pages.length === 0 ||
    !startHistoryId
  ) {
    return await refreshLoadedMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        refreshThreads: true,
        signal,
      }
    );
  }

  const syncDelta = await rpc.mail.syncMailbox(
    {
      category: mailbox,
      mailboxId,
      startHistoryId,
    },
    { signal }
  );

  signal?.throwIfAborted();
  if (syncDelta.requiresFullRefresh) {
    return await refreshLoadedMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        refreshThreads: true,
        signal,
      }
    );
  }

  await applyMailboxSyncDelta(
    queryClient,
    mailboxId,
    messagesQueryKey,
    syncDelta.updatedMessages,
    syncDelta.removedMessageIds,
    signal,
    syncDelta.refreshThreadIds
  );

  if (syncDelta.refreshFirstPage) {
    await refreshLoadedMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        maxPageCount: 1,
        preserveHistoryId: startHistoryId,
        preserveUnrefreshedPages: true,
        signal,
      }
    );
  }
  signal?.throwIfAborted();
  const { historyId } = syncDelta;
  if (historyId && historyId !== startHistoryId) {
    updateMailQueryFromServer<MessagesQueryData>(
      queryClient,
      messagesQueryKey,
      (data) => updateFirstPageHistoryId(data, historyId)
    );
    await persistQueryByKey(messagesQueryKey, queryClient);
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
  enabled = true
) => {
  const initialData =
    mailboxId === LANDING_DEMO_MAILBOX_ID
      ? {
          pageParams: [undefined],
          pages: [
            listDemoMessages({
              category: mailbox,
              mailboxId,
              maxResults: 50,
              query: normalizeSearchQuery(searchQuery),
            }),
          ],
        }
      : undefined;
  const persister = normalizeSearchQuery(searchQuery)
    ? undefined
    : messagesQueryPersister;

  return infiniteQueryOptions<
    ListMessagesPageResult,
    unknown,
    MessagesQueryData,
    ReturnType<typeof getMessagesQueryKey>,
    string | undefined
  >({
    enabled,
    gcTime: 1000 * 60 * 30,
    getNextPageParam: (lastPage: ListMessagesPageResult) =>
      lastPage.nextPageToken ?? undefined,
    initialData,
    initialPageParam: undefined as string | undefined,
    persister,
    queryFn: async ({ pageParam, signal }) =>
      await fetchMessagesPage(
        mailboxId,
        mailbox,
        parsePageToken(pageParam),
        searchQuery,
        signal
      ),
    queryKey: getMessagesQueryKey(mailboxId, mailbox, searchQuery),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: shouldRetryOrpcError,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
  });
};

export const liveSyncQueryOptions = (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  enabled = true
) =>
  queryOptions({
    enabled,
    initialData: () =>
      queryClient.getQueryData<MessagesQueryData>(
        getMessagesQueryKey(mailboxId, mailbox, searchQuery)
      )?.pages[0],
    queryFn: async ({ signal }) =>
      await syncMessages(queryClient, mailboxId, mailbox, searchQuery, signal),
    queryKey: getLiveSyncQueryKey(mailboxId, mailbox, searchQuery),
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: shouldRetryOrpcError,
    staleTime: 0,
  });
