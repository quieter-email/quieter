import { infiniteQueryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { GMAIL_QUERY_STALE_TIME_MS } from "#/lib/mail";
import type { ListMessagesPageResult, MailboxCategory } from "#/lib/mail";
import { MailSyncSession } from "#/lib/mail-sync/session";
import { listManagedDemoMessages } from "#/lib/managed-mail/demo-managed-mail";
import { rpc } from "#/lib/orpc";
import { shouldRetryOrpcError } from "#/lib/orpc-errors";
import {
  isManagedSandboxMailboxId,
  isSandboxMailboxId,
} from "#/lib/sandbox-mailbox";

import { LANDING_DEMO_MAILBOX_ID, listDemoMessages } from "../demo-mail";
import { mergeRefreshedMailboxPagesIntoQueryData } from "./data";
import type { MessagesQueryData } from "./data";
import {
  getMessagesQueryKey,
  normalizeSearchQuery,
  parsePageToken,
} from "./keys";
import { getCachedMessagesQueries } from "./query-cache";

// Bound manual refresh work for deeply paginated lists.
const GMAIL_MAILBOX_REFRESH_PAGE_LIMIT = 3;

type RefreshLoadedMessagesPagesOptions = {
  maxPageCount?: number;
  preserveUnrefreshedPages?: boolean;
  signal?: AbortSignal;
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

  const sync = mailboxId.startsWith("api:")
    ? null
    : await MailSyncSession.waitForMailbox(mailboxId, signal);
  const reconcile = sync?.adapter.beginListRead(
    mailboxId,
    mailbox,
    pageToken === undefined,
    !!normalizeSearchQuery(searchQuery)
  );
  const page = await rpc.mail.listThreads(
    {
      category: mailbox,
      mailboxId,
      maxResults: 15,
      pageToken,
      query: normalizeSearchQuery(searchQuery),
    },
    { signal }
  );
  signal?.throwIfAborted();
  return reconcile?.(page) ?? page;
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

  queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, (data) =>
    mergeRefreshedMailboxPagesIntoQueryData(
      data,
      refreshedPages,
      refreshedPageParams,
      {
        preserveUnrefreshedPages:
          options.preserveUnrefreshedPages ??
          refreshedPageCount < loadedPageCount,
      }
    )
  );

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
    placeholderData: (previous) => {
      if (previous !== undefined || normalizeSearchQuery(searchQuery)) {
        return previous;
      }
      const page = MailSyncSession.forMailbox(mailboxId)?.adapter.cachedList(
        mailboxId,
        mailbox
      );
      return page === undefined
        ? undefined
        : { pageParams: [undefined], pages: [page] };
    },
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
