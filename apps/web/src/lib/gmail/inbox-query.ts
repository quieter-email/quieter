import type { QueryClient } from "@tanstack/solid-query";
import { queryOptions } from "@tanstack/solid-query";
import { trpc } from "~/lib/trpc";
import {
  GMAIL_QUERY_STALE_TIME_MS,
  listMessagesWithDetails,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
} from "./gmail";

export const getMessagesQueryKey = (mailbox: MailboxCategory) => ["messages", mailbox] as const;
export const getLiveSyncQueryKey = (mailbox: MailboxCategory) =>
  [...getMessagesQueryKey(mailbox), "live-sync"] as const;
const LIVE_SYNC_REFETCH_INTERVAL_MS = 20000;

export type MessagesQueryData = {
  pages: ListMessagesPageResult[];
  pageParams: Array<string | undefined>;
};

const parsePageToken = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const loadPersistedMessages = async (
  messageIds: string[],
  signal?: AbortSignal,
): Promise<MessageListItem[]> => {
  if (messageIds.length === 0) return [];

  const messages = await trpc.gmail.getCachedMessages.query({ messageIds }, { signal });

  return messages;
};

const persistFetchedMessages = async (messages: MessageListItem[], signal?: AbortSignal) => {
  if (messages.length === 0) return;

  await trpc.gmail.upsertCachedMessages.mutate({ messages }, { signal });
};

const fetchMessagesPage = async (
  mailbox: MailboxCategory,
  pageToken: string | undefined,
  cachedMessagesById: ReadonlyMap<string, MessageListItem>,
  signal?: AbortSignal,
): Promise<ListMessagesPageResult> =>
  listMessagesWithDetails({
    mailbox,
    pageToken,
    maxResults: pageToken ? 25 : 50,
    cachedMessagesById,
    loadCachedMessages: loadPersistedMessages,
    persistFetchedMessages,
    signal,
  });

const toCachedMessagesById = (
  data: MessagesQueryData | undefined,
): Map<string, MessageListItem> => {
  const cache = new Map<string, MessageListItem>();
  if (!data) return cache;

  for (const page of data.pages) {
    for (const message of page.messages) {
      cache.set(message.id, message);
    }
  }

  return cache;
};

const toFirstPageData = (firstPage: ListMessagesPageResult): MessagesQueryData => ({
  pages: [firstPage],
  pageParams: [undefined],
});

const toLoadedPagesData = (
  pages: ListMessagesPageResult[],
  pageParams: Array<string | undefined>,
): MessagesQueryData => ({
  pages,
  pageParams,
});

export const refreshMessagesFirstPage = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  signal?: AbortSignal,
) => {
  const refreshedFirstPage = await fetchMessagesPage(
    mailbox,
    undefined,
    new Map<string, MessageListItem>(),
    signal,
  );

  queryClient.setQueryData<MessagesQueryData>(
    getMessagesQueryKey(mailbox),
    toFirstPageData(refreshedFirstPage),
  );

  return refreshedFirstPage;
};

export const refreshLoadedMessagesPages = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox);
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const cachedMessages = toCachedMessagesById(currentMessages);
  const loadedPageCount = Math.max(currentMessages?.pages.length ?? 0, 1);

  const refreshedPages: ListMessagesPageResult[] = [];
  const refreshedPageParams: Array<string | undefined> = [];
  let pageToken: string | undefined;

  for (let pageIndex = 0; pageIndex < loadedPageCount; pageIndex += 1) {
    refreshedPageParams.push(pageToken);

    const refreshedPage = await fetchMessagesPage(mailbox, pageToken, cachedMessages, signal);
    refreshedPages.push(refreshedPage);

    if (!refreshedPage.nextPageToken) break;
    pageToken = refreshedPage.nextPageToken;
  }

  queryClient.setQueryData<MessagesQueryData>(
    messagesQueryKey,
    toLoadedPagesData(refreshedPages, refreshedPageParams),
  );

  return refreshedPages[0];
};

export const messagesQueryOptions = (queryClient: QueryClient, mailbox: MailboxCategory) => ({
  queryKey: getMessagesQueryKey(mailbox),
  queryFn: (ctx: { pageParam: unknown; signal: AbortSignal }) => {
    const messagesQueryKey = getMessagesQueryKey(mailbox);
    const cachedMessages = toCachedMessagesById(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey),
    );

    return fetchMessagesPage(mailbox, parsePageToken(ctx.pageParam), cachedMessages, ctx.signal);
  },
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage: ListMessagesPageResult) => lastPage.nextPageToken ?? undefined,
  staleTime: GMAIL_QUERY_STALE_TIME_MS,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export const liveSyncQueryOptions = (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  enabled = true,
) =>
  queryOptions({
    queryKey: getLiveSyncQueryKey(mailbox),
    queryFn: ({ signal }) => refreshLoadedMessagesPages(queryClient, mailbox, signal),
    enabled,
    persister: undefined,
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: LIVE_SYNC_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
