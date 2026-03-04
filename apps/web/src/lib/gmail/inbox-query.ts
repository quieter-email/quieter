import type { QueryClient } from "@tanstack/solid-query";
import { queryOptions } from "@tanstack/solid-query";
import { persistQueryByKey } from "~/lib/query-persister";
import { trpc } from "~/lib/trpc";
import {
  addUnreadLabel,
  GMAIL_QUERY_STALE_TIME_MS,
  isMessageUnread,
  listMessagesWithDetails,
  markMessageAsRead,
  markMessageAsUnread,
  removeUnreadLabel,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
  type ThreadMessagesResult,
} from "./gmail";
import { getThreadQueryKey } from "./thread-query";

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

const updateMessageInQueryData = (
  data: MessagesQueryData | undefined,
  messageId: string,
  updater: (message: MessageListItem) => MessageListItem,
): MessagesQueryData | undefined => {
  if (!data) return data;

  let hasChanges = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const messages = page.messages.map((message) => {
      if (message.id !== messageId) return message;

      const nextMessage = updater(message);
      if (nextMessage === message) return message;

      pageChanged = true;
      hasChanges = true;
      return nextMessage;
    });

    return pageChanged ? { ...page, messages } : page;
  });

  if (!hasChanges) return data;

  return {
    ...data,
    pages,
  };
};

const findMessageInQueryData = (
  data: MessagesQueryData | undefined,
  messageId: string,
): MessageListItem | undefined => {
  if (!data) return undefined;

  for (const page of data.pages) {
    for (const message of page.messages) {
      if (message.id === messageId) {
        return message;
      }
    }
  }

  return undefined;
};

const updateMessageInThreadData = (
  data: ThreadMessagesResult | undefined,
  messageId: string,
  updater: (message: MessageListItem) => MessageListItem,
): ThreadMessagesResult | undefined => {
  if (!data) return data;

  let hasChanges = false;
  const messages = data.messages.map((message) => {
    if (message.id !== messageId) return message;

    const nextMessage = updater(message);
    if (nextMessage === message) return message;

    hasChanges = true;
    return nextMessage;
  });

  if (!hasChanges) return data;

  return {
    ...data,
    messages,
  };
};

const markMessageReadLocally = (message: MessageListItem): MessageListItem => {
  if (!isMessageUnread(message)) return message;

  return {
    ...message,
    labelIds: removeUnreadLabel(message.labelIds),
    isUnread: false,
  };
};

const markMessageUnreadLocally = (message: MessageListItem): MessageListItem => {
  if (isMessageUnread(message)) return message;

  return {
    ...message,
    labelIds: addUnreadLabel(message.labelIds),
    isUnread: true,
  };
};

const areLabelIdsEquivalent = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean => {
  if (!left?.length && !right?.length) return true;
  if (!left || !right || left.length !== right.length) return false;

  const rightSet = new Set(right);

  for (const labelId of left) {
    if (!rightSet.has(labelId)) return false;
  }

  return true;
};

const applyMessageReadState = (
  message: MessageListItem,
  next: { labelIds: string[] | undefined; isUnread: boolean },
): MessageListItem => {
  if (
    message.isUnread === next.isUnread &&
    areLabelIdsEquivalent(message.labelIds, next.labelIds)
  ) {
    return message;
  }

  return {
    ...message,
    labelIds: next.labelIds,
    isUnread: next.isUnread,
  };
};

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
  await persistQueryByKey(queryClient, getMessagesQueryKey(mailbox));

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
  await persistQueryByKey(queryClient, messagesQueryKey);

  return refreshedPages[0];
};

export const markMessageAsReadInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  messageId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox);
  const previousData = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const messageToUpdate = findMessageInQueryData(previousData, messageId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(threadId) : null;
  const previousThreadData = threadQueryKey
    ? queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey)
    : undefined;

  queryClient.setQueryData<MessagesQueryData | undefined>(messagesQueryKey, (currentData) =>
    updateMessageInQueryData(currentData, messageId, markMessageReadLocally),
  );
  if (threadQueryKey) {
    queryClient.setQueryData<ThreadMessagesResult | undefined>(threadQueryKey, (currentData) =>
      updateMessageInThreadData(currentData, messageId, markMessageReadLocally),
    );
  }
  await persistQueryByKey(queryClient, messagesQueryKey);
  if (threadQueryKey) {
    await persistQueryByKey(queryClient, threadQueryKey);
  }

  try {
    const updatedMessage = await markMessageAsRead(messageId, { signal });

    queryClient.setQueryData<MessagesQueryData | undefined>(messagesQueryKey, (currentData) =>
      updateMessageInQueryData(currentData, messageId, (message) => {
        const optimisticMessage = markMessageReadLocally(message);

        return applyMessageReadState(optimisticMessage, {
          labelIds: updatedMessage.labelIds ?? removeUnreadLabel(optimisticMessage.labelIds),
          isUnread: updatedMessage.isUnread,
        });
      }),
    );
    if (threadQueryKey) {
      queryClient.setQueryData<ThreadMessagesResult | undefined>(threadQueryKey, (currentData) =>
        updateMessageInThreadData(currentData, messageId, (message) => {
          const optimisticMessage = markMessageReadLocally(message);

          return applyMessageReadState(optimisticMessage, {
            labelIds: updatedMessage.labelIds ?? removeUnreadLabel(optimisticMessage.labelIds),
            isUnread: updatedMessage.isUnread,
          });
        }),
      );
    }
    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) {
      await persistQueryByKey(queryClient, threadQueryKey);
    }
  } catch (error) {
    queryClient.setQueryData(messagesQueryKey, previousData);
    if (threadQueryKey) {
      queryClient.setQueryData(threadQueryKey, previousThreadData);
    }
    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) {
      await persistQueryByKey(queryClient, threadQueryKey);
    }
    throw error;
  }
};

export const markMessageAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  messageId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox);
  const previousData = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const messageToUpdate = findMessageInQueryData(previousData, messageId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(threadId) : null;
  const previousThreadData = threadQueryKey
    ? queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey)
    : undefined;

  queryClient.setQueryData<MessagesQueryData | undefined>(messagesQueryKey, (currentData) =>
    updateMessageInQueryData(currentData, messageId, markMessageUnreadLocally),
  );
  if (threadQueryKey) {
    queryClient.setQueryData<ThreadMessagesResult | undefined>(threadQueryKey, (currentData) =>
      updateMessageInThreadData(currentData, messageId, markMessageUnreadLocally),
    );
  }
  await persistQueryByKey(queryClient, messagesQueryKey);
  if (threadQueryKey) {
    await persistQueryByKey(queryClient, threadQueryKey);
  }

  try {
    const updatedMessage = await markMessageAsUnread(messageId, { signal });

    queryClient.setQueryData<MessagesQueryData | undefined>(messagesQueryKey, (currentData) =>
      updateMessageInQueryData(currentData, messageId, (message) => {
        const optimisticMessage = markMessageUnreadLocally(message);

        return applyMessageReadState(optimisticMessage, {
          labelIds: updatedMessage.labelIds ?? addUnreadLabel(optimisticMessage.labelIds),
          isUnread: updatedMessage.isUnread,
        });
      }),
    );
    if (threadQueryKey) {
      queryClient.setQueryData<ThreadMessagesResult | undefined>(threadQueryKey, (currentData) =>
        updateMessageInThreadData(currentData, messageId, (message) => {
          const optimisticMessage = markMessageUnreadLocally(message);

          return applyMessageReadState(optimisticMessage, {
            labelIds: updatedMessage.labelIds ?? addUnreadLabel(optimisticMessage.labelIds),
            isUnread: updatedMessage.isUnread,
          });
        }),
      );
    }
    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) {
      await persistQueryByKey(queryClient, threadQueryKey);
    }
  } catch (error) {
    queryClient.setQueryData(messagesQueryKey, previousData);
    if (threadQueryKey) {
      queryClient.setQueryData(threadQueryKey, previousThreadData);
    }
    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) {
      await persistQueryByKey(queryClient, threadQueryKey);
    }
    throw error;
  }
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
