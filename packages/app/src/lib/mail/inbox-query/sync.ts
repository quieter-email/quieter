import {
  LANDING_DEMO_MAILBOX_ID,
  listDemoMessages,
} from "@quieter/app/lib/gmail/demo-mail";
import {
  GMAIL_QUERY_STALE_TIME_MS,
  hasRenderableMessageBody,
} from "@quieter/app/lib/mail";
import type {
  ListMessagesPageResult,
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import { updateMailQueryFromServer } from "@quieter/app/lib/mail-mutations";
import {
  applySyncDeltaToQueryData,
  mergeRefreshedMailboxPagesIntoQueryData,
  updateFirstPageHistoryId,
  upsertMessageInThreadData,
} from "@quieter/app/lib/mail/inbox-query/data";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
  normalizeSearchQuery,
  parsePageToken,
} from "@quieter/app/lib/mail/inbox-query/keys";
import { getCachedMessagesQueries } from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query";
import { listManagedDemoMessages } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { rpc } from "@quieter/app/lib/orpc";
import { shouldRetryOrpcError } from "@quieter/app/lib/orpc-errors";
import {
  persistQueryByKey,
  queryPersister,
  subscribeQuerySessionInvalidation,
} from "@quieter/app/lib/query-persister";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { QueryClient, QueryPersister } from "@tanstack/react-query";

// Keep full-refresh fallbacks bounded after an infinite query restores a deep persisted list.
const GMAIL_MAILBOX_REFRESH_PAGE_LIMIT = 3;
const MESSAGE_PAGE_SIZE = 15;
const OTHER_MESSAGE_PAGE_SIZE = 25;

type MessagesQueryKey = ReturnType<typeof getMessagesQueryKey>;

export const liveMailboxChangeVersions = new WeakMap<
  QueryClient,
  ReadonlyMap<string, string>
>();

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
  preserveHistoryId?: string;
  preserveUnrefreshedPages?: boolean;
  refreshThreads?: boolean;
  signal?: AbortSignal;
};

const fetchMessagesPage = async (
  mailboxId: string,
  mailbox: MailboxCategory,
  pageToken: string | undefined,
  searchQuery?: string | null,
  signal?: AbortSignal
) => {
  const maxResults =
    pageToken === undefined ? MESSAGE_PAGE_SIZE : OTHER_MESSAGE_PAGE_SIZE;
  if (isManagedSandboxMailboxId(mailboxId)) {
    return listManagedDemoMessages({
      category: mailbox,
      maxResults,
      pageToken,
      query: normalizeSearchQuery(searchQuery),
    });
  }

  if (isSandboxMailboxId(mailboxId)) {
    return listDemoMessages({
      category: mailbox,
      mailboxId,
      maxResults,
      pageToken,
      query: normalizeSearchQuery(searchQuery),
    });
  }

  return await rpc.mail.listThreads(
    {
      category: mailbox,
      mailboxId,
      maxResults,
      pageToken,
      query: normalizeSearchQuery(searchQuery),
    },
    { signal }
  );
};

type RefreshOperation = {
  signal: AbortSignal;
  assertCurrent: () => void;
  finish: () => void;
  restorePagination?: () => void;
  cancel: () => void;
};

const refreshOperations = new WeakMap<
  QueryClient,
  Map<string, RefreshOperation>
>();

const beginRefresh = (
  queryClient: QueryClient,
  queryKey: MessagesQueryKey,
  signal?: AbortSignal
): RefreshOperation => {
  const existing = refreshOperations.get(queryClient);
  const operations = existing ?? new Map<string, RefreshOperation>();
  if (!existing) {
    refreshOperations.set(queryClient, operations);
    subscribeQuerySessionInvalidation(queryClient, () => {
      for (const operation of operations.values()) {
        operation.cancel();
      }
      operations.clear();
    });
  }
  const key = JSON.stringify(queryKey);
  operations.get(key)?.cancel();
  const controller = new AbortController();
  const query = queryClient
    .getQueryCache()
    .build<unknown, Error, unknown>(queryClient, { queryKey });
  const operation: RefreshOperation = {
    assertCurrent: () => {
      operation.signal.throwIfAborted();
      if (
        operations.get(key) !== operation ||
        queryClient.getQueryCache().get(query.queryHash) !== query
      ) {
        throw new DOMException("Mail refresh superseded", "AbortError");
      }
    },
    cancel: () => {
      operation.restorePagination?.();
      operation.restorePagination = undefined;
      controller.abort();
    },
    finish: () => {
      if (operations.get(key) === operation) {
        operation.restorePagination?.();
        operations.delete(key);
      }
    },
    signal: signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal,
  };
  operations.set(key, operation);
  return operation;
};

const refreshMessagesPages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  options: RefreshLoadedMessagesPagesOptions,
  operation: RefreshOperation
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  await queryClient.cancelQueries({ exact: true, queryKey: messagesQueryKey });
  operation.assertCurrent();
  const messagesQuery = queryClient
    .getQueryCache()
    .find({ exact: true, queryKey: messagesQueryKey });
  const currentMessages =
    queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const loadedPageCount = Math.max(currentMessages?.pages.length ?? 0, 1);
  const refreshedPageCount = Math.min(
    loadedPageCount,
    Math.max(1, options.maxPageCount ?? GMAIL_MAILBOX_REFRESH_PAGE_LIMIT)
  );
  const refreshedPages: ListMessagesPageResult[] = [];
  const refreshedPageParams: (string | undefined)[] = [];
  const oldHistoryId =
    options.preserveHistoryId ?? currentMessages?.pages[0]?.historyId;
  const oldChangeVersion = currentMessages?.pages[0]?.changeVersion;
  const preserveUnrefreshedPages = options.preserveUnrefreshedPages !== false;
  // Sandbox lists return individual messages; every other list returns one row per thread.
  const rowScope = isSandboxMailboxId(mailboxId) ? "message" : "thread";
  let pageToken: string | undefined;
  // Intermediate publications hide the tail continuation until the refresh settles.
  let withheldContinuation:
    | { pageCount: number; pageParam: string | undefined; token: string }
    | undefined;
  const restoreWithheldContinuation = (
    data: MessagesQueryData
  ): MessagesQueryData => {
    const lastPageIndex = data.pages.length - 1;
    if (
      withheldContinuation === undefined ||
      data.pages.length !== withheldContinuation.pageCount ||
      data.pageParams[lastPageIndex] !== withheldContinuation.pageParam ||
      data.pages[lastPageIndex].nextPageToken !== undefined
    ) {
      return data;
    }
    const { token } = withheldContinuation;
    return {
      ...data,
      pages: data.pages.map((page, index) =>
        index === lastPageIndex ? { ...page, nextPageToken: token } : page
      ),
    };
  };

  const publish = (complete: boolean) => {
    operation.assertCurrent();
    const pages = refreshedPages.map((page, index) => ({
      ...page,
      ...(index === 0 && !complete
        ? { changeVersion: oldChangeVersion, historyId: oldHistoryId }
        : {}),
    }));
    if (options.preserveHistoryId !== undefined) {
      pages[0].historyId = options.preserveHistoryId;
      pages[0].changeVersion = oldChangeVersion;
    }
    updateMailQueryFromServer<MessagesQueryData>(
      queryClient,
      messagesQueryKey,
      (data) => {
        const merged = mergeRefreshedMailboxPagesIntoQueryData(
          data === undefined ? data : restoreWithheldContinuation(data),
          pages,
          refreshedPageParams,
          { preserveUnrefreshedPages, rowScope }
        );
        const lastPageIndex = merged.pages.length - 1;
        const continuationToken = merged.pages[lastPageIndex]?.nextPageToken;
        withheldContinuation =
          complete ||
          continuationToken === undefined ||
          continuationToken === ""
            ? undefined
            : {
                pageCount: merged.pages.length,
                pageParam: merged.pageParams[lastPageIndex],
                token: continuationToken,
              };
        const publishedPages: MessagesQueryData["pages"] = merged.pages.map(
          (page, index) => ({
            ...page,
            ...(index === 0 ? { refreshing: complete ? undefined : true } : {}),
            ...(!complete && index === lastPageIndex
              ? { nextPageToken: undefined }
              : {}),
          })
        );
        return { ...merged, pages: publishedPages };
      }
    );
  };

  operation.restorePagination = () => {
    if (
      queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: messagesQueryKey }) !== messagesQuery
    ) {
      return;
    }
    updateMailQueryFromServer<MessagesQueryData>(
      queryClient,
      messagesQueryKey,
      (data) => {
        if (!data?.pages[0]?.refreshing) {
          return data;
        }
        const restored = restoreWithheldContinuation(data);
        return {
          ...restored,
          pages: restored.pages.map((page, index) =>
            index === 0 ? { ...page, refreshing: undefined } : page
          ),
        };
      }
    );
  };
  try {
    for (let pageIndex = 0; pageIndex < refreshedPageCount; pageIndex += 1) {
      operation.assertCurrent();
      const refreshedPage = await fetchMessagesPage(
        mailboxId,
        mailbox,
        pageToken,
        searchQuery,
        operation.signal
      );
      operation.assertCurrent();
      if (pageIndex === 0) {
        await queryClient.cancelQueries({
          exact: true,
          queryKey: messagesQueryKey,
        });
        operation.assertCurrent();
      }
      refreshedPageParams.push(pageToken);
      refreshedPages.push(refreshedPage);
      pageToken = refreshedPage.nextPageToken ?? undefined;
      const complete = !pageToken || pageIndex + 1 === refreshedPageCount;
      publish(complete);
      if (complete) {
        operation.restorePagination = undefined;
        break;
      }
    }
  } catch (error) {
    operation.restorePagination?.();
    operation.restorePagination = undefined;
    throw error;
  }
  const touchedThreadQueryKeys = new Map<
    string,
    ReturnType<typeof getThreadQueryKey>
  >();
  for (const page of refreshedPages) {
    operation.assertCurrent();
    for (const message of page.messages) {
      const threadQueryKey = getThreadQueryKey(mailboxId, message.threadId);
      if (queryClient.getQueryData(threadQueryKey) === undefined) {
        continue;
      }
      touchedThreadQueryKeys.set(message.threadId, threadQueryKey);
      updateMailQueryFromServer<ThreadMessagesResult>(
        queryClient,
        threadQueryKey,
        (data) => upsertMessageInThreadData(data, message)
      );
    }
  }
  operation.assertCurrent();
  await Promise.all([
    persistQueryByKey(messagesQueryKey, queryClient),
    ...Array.from(touchedThreadQueryKeys.values(), async (threadQueryKey) => {
      await persistQueryByKey(threadQueryKey, queryClient);
    }),
    ...(options.refreshThreads === true
      ? [
          queryClient.invalidateQueries(
            {
              predicate: ({ queryKey }) =>
                queryKey[0] === "message-thread" && queryKey[2] === mailboxId,
            },
            { cancelRefetch: true }
          ),
        ]
      : []),
  ]);
  operation.assertCurrent();
  return refreshedPages[0];
};

export const refreshLoadedMessagesPages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  options: RefreshLoadedMessagesPagesOptions = {}
) => {
  const operation = beginRefresh(
    queryClient,
    getMessagesQueryKey(mailboxId, mailbox, searchQuery),
    options.signal
  );
  try {
    return await refreshMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      options,
      operation
    );
  } finally {
    operation.finish();
  }
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
  refreshThreadIds: readonly string[] = [],
  replacedThreadIds?: readonly string[]
) => {
  signal?.throwIfAborted();
  const threadsNeedingRefresh = new Set(refreshThreadIds);
  for (const [, thread] of queryClient.getQueriesData<ThreadMessagesResult>({
    predicate: ({ queryKey }) =>
      queryKey[0] === "message-thread" && queryKey[2] === mailboxId,
  })) {
    if (
      thread !== undefined &&
      thread.messages.some((message) => removedMessageIds.includes(message.id))
    ) {
      threadsNeedingRefresh.add(thread.threadId);
    }
  }
  if (
    updatedMessages.length > 0 ||
    removedMessageIds.length > 0 ||
    (replacedThreadIds?.length ?? 0) > 0
  ) {
    updateMailQueryFromServer<MessagesQueryData>(
      queryClient,
      messagesQueryKey,
      (data) =>
        applySyncDeltaToQueryData(
          data,
          updatedMessages,
          removedMessageIds,
          replacedThreadIds
        )
    );
  }

  const touchedThreadQueryKeys = new Map<
    string,
    ReturnType<typeof getThreadQueryKey>
  >();

  // A list anchor carries aggregate metadata. Refresh the full thread from its own read path.
  for (const updatedMessage of replacedThreadIds === undefined
    ? updatedMessages
    : []) {
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

  await Promise.all([
    persistQueryByKey(messagesQueryKey, queryClient),
    ...Array.from(touchedThreadQueryKeys.values(), async (threadQueryKey) => {
      await persistQueryByKey(threadQueryKey, queryClient);
    }),
  ]);
  signal?.throwIfAborted();
  await Promise.all(
    [...threadsNeedingRefresh].map(async (threadId) => {
      const filters = {
        exact: true,
        queryKey: getThreadQueryKey(mailboxId, threadId),
      };
      if (replacedThreadIds !== undefined) {
        await queryClient.cancelQueries(filters);
        signal?.throwIfAborted();
      }
      await queryClient.invalidateQueries(filters, { cancelRefetch: true });
    })
  );
};

const syncOwnedMessages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  signal: AbortSignal,
  operation: RefreshOperation
) => {
  if (isSandboxMailboxId(mailboxId)) {
    return await refreshMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        signal,
      },
      operation
    );
  }

  if (mailbox === "drafts" || normalizeSearchQuery(searchQuery)) {
    return await refreshMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        preserveUnrefreshedPages: false,
        signal,
      },
      operation
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
    return await refreshMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        refreshThreads: true,
        signal,
      },
      operation
    );
  }

  operation.assertCurrent();
  const targetChangeVersion = liveMailboxChangeVersions
    .get(queryClient)
    ?.get(mailboxId);
  const startChangeVersion = currentMessages.pages[0].changeVersion;
  if (
    targetChangeVersion !== undefined &&
    startChangeVersion !== undefined &&
    BigInt(targetChangeVersion) <= BigInt(startChangeVersion)
  ) {
    return currentMessages.pages[0];
  }
  const syncDelta = await rpc.mail.syncMailbox(
    {
      category: mailbox,
      mailboxId,
      startChangeVersion: startChangeVersion ?? "0",
      startHistoryId,
      targetChangeVersion,
    },
    { signal }
  );

  operation.assertCurrent();
  if (syncDelta.requiresFullRefresh) {
    return await refreshMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        ...(startChangeVersion === undefined
          ? {}
          : { preserveUnrefreshedPages: false }),
        refreshThreads: true,
        signal,
      },
      operation
    );
  }

  if (
    syncDelta.updatedMessages.length > 0 ||
    syncDelta.removedMessageIds.length > 0 ||
    Boolean(syncDelta.replacedThreadIds?.length) ||
    syncDelta.refreshFirstPage
  ) {
    await queryClient.cancelQueries({
      exact: true,
      queryKey: messagesQueryKey,
    });
    operation.assertCurrent();
  }

  await applyMailboxSyncDelta(
    queryClient,
    mailboxId,
    messagesQueryKey,
    syncDelta.updatedMessages,
    syncDelta.removedMessageIds,
    signal,
    syncDelta.refreshThreadIds,
    syncDelta.replacedThreadIds
  );

  if (syncDelta.refreshFirstPage) {
    await refreshMessagesPages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      {
        maxPageCount: 1,
        preserveHistoryId: startHistoryId,
        signal,
      },
      operation
    );
  }
  operation.assertCurrent();
  const { changeVersion, historyId } = syncDelta;
  if (
    historyId &&
    (historyId !== startHistoryId || changeVersion !== startChangeVersion)
  ) {
    updateMailQueryFromServer<MessagesQueryData>(
      queryClient,
      messagesQueryKey,
      (data) => updateFirstPageHistoryId(data, historyId, changeVersion)
    );
    await persistQueryByKey(messagesQueryKey, queryClient);
  }

  return (
    queryClient.getQueryData<MessagesQueryData>(messagesQueryKey)?.pages[0] ??
    currentMessages.pages[0]
  );
};

export const syncMessages = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal
) => {
  const operation = beginRefresh(
    queryClient,
    getMessagesQueryKey(mailboxId, mailbox, searchQuery),
    signal
  );
  try {
    return await syncOwnedMessages(
      queryClient,
      mailboxId,
      mailbox,
      searchQuery,
      operation.signal,
      operation
    );
  } finally {
    operation.finish();
  }
};

export const messagesQueryOptions = (
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  enabled = true,
  ownsLiveSync = false
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
  const persister =
    mailbox === "drafts" || normalizeSearchQuery(searchQuery)
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
    meta: { ownsMailLiveSync: ownsLiveSync },
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
    refetchOnMount: mailbox === "drafts" ? "always" : false,
    refetchOnReconnect: mailbox === "drafts" ? "always" : false,
    refetchOnWindowFocus: mailbox === "drafts" ? "always" : false,
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
