import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { persistQueryByKey } from "~/lib/query-persister";
import { trpc } from "~/lib/trpc";
import {
  addUnreadLabel,
  applyLabelIdChanges,
  GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS,
  GMAIL_QUERY_STALE_TIME_MS,
  isMessageUnread,
  removeUnreadLabel,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
  type ThreadMessagesResult,
} from "./gmail";
import { getThreadQueryKey } from "./thread-query";

const normalizeSearchQuery = (searchQuery: string | null | undefined) => {
  const normalized = searchQuery?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

export const getMessagesQueryKey = (mailbox: MailboxCategory, searchQuery?: string | null) =>
  ["messages", mailbox, normalizeSearchQuery(searchQuery) ?? ""] as const;

export const getLiveSyncQueryKey = (mailbox: MailboxCategory, searchQuery?: string | null) =>
  [...getMessagesQueryKey(mailbox, searchQuery), "live-sync"] as const;

export type MessagesQueryData = {
  pages: ListMessagesPageResult[];
  pageParams: Array<string | undefined>;
};

type MessageMetadataMutationResult = {
  id: string;
  labelIds?: string[];
  isUnread: boolean;
};

type ThreadMetadataMutationResult = {
  threadId: string;
  messages: MessageMetadataMutationResult[];
};

const parsePageToken = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
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

const replaceFirstPageInQueryData = (
  data: MessagesQueryData | undefined,
  firstPage: ListMessagesPageResult,
): MessagesQueryData => {
  if (!data?.pages.length) {
    return toFirstPageData(firstPage);
  }

  return {
    pages: [firstPage, ...data.pages.slice(1)],
    pageParams: [undefined, ...data.pageParams.slice(1)],
  };
};

const updateFirstPageHistoryId = (
  data: MessagesQueryData | undefined,
  historyId: string,
): MessagesQueryData | undefined => {
  const firstPage = data?.pages[0];
  if (!data || !firstPage || firstPage.historyId === historyId) {
    return data;
  }

  return {
    ...data,
    pages: [{ ...firstPage, historyId }, ...data.pages.slice(1)],
  };
};

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

      hasChanges = true;
      pageChanged = true;
      return nextMessage;
    });

    return pageChanged ? { ...page, messages } : page;
  });

  return hasChanges ? { ...data, pages } : data;
};

const updateMessagesInQueryData = (
  data: MessagesQueryData | undefined,
  predicate: (message: MessageListItem) => boolean,
  updater: (message: MessageListItem) => MessageListItem,
): MessagesQueryData | undefined => {
  if (!data) return data;

  let hasChanges = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const messages = page.messages.map((message) => {
      if (!predicate(message)) return message;

      const nextMessage = updater(message);
      if (nextMessage === message) return message;

      hasChanges = true;
      pageChanged = true;
      return nextMessage;
    });

    return pageChanged ? { ...page, messages } : page;
  });

  return hasChanges ? { ...data, pages } : data;
};

const findMessageInQueryData = (data: MessagesQueryData | undefined, messageId: string) => {
  if (!data) return undefined;

  for (const page of data.pages) {
    for (const message of page.messages) {
      if (message.id === messageId) return message;
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

  return hasChanges ? { ...data, messages } : data;
};

const updateMessagesInThreadData = (
  data: ThreadMessagesResult | undefined,
  predicate: (message: MessageListItem) => boolean,
  updater: (message: MessageListItem) => MessageListItem,
): ThreadMessagesResult | undefined => {
  if (!data) return data;

  let hasChanges = false;
  const messages = data.messages.map((message) => {
    if (!predicate(message)) return message;
    const nextMessage = updater(message);
    if (nextMessage === message) return message;
    hasChanges = true;
    return nextMessage;
  });

  return hasChanges ? { ...data, messages } : data;
};

const removeMessageFromQueryData = (
  data: MessagesQueryData | undefined,
  messageId: string,
): MessagesQueryData | undefined => {
  if (!data) return data;

  let hasChanges = false;
  const pages = data.pages.map((page) => {
    const messages = page.messages.filter((message) => message.id !== messageId);
    if (messages.length === page.messages.length) return page;
    hasChanges = true;
    return { ...page, messages };
  });

  return hasChanges ? { ...data, pages } : data;
};

const removeMessageFromThreadData = (
  data: ThreadMessagesResult | undefined,
  messageId: string,
): ThreadMessagesResult | undefined => {
  if (!data) return data;
  const messages = data.messages.filter((message) => message.id !== messageId);
  return messages.length === data.messages.length ? data : { ...data, messages };
};

const markMessageReadLocally = (message: MessageListItem): MessageListItem => {
  if (!isMessageUnread(message)) return message;
  return { ...message, labelIds: removeUnreadLabel(message.labelIds), isUnread: false };
};

const markMessageUnreadLocally = (message: MessageListItem): MessageListItem => {
  if (isMessageUnread(message)) return message;
  return { ...message, labelIds: addUnreadLabel(message.labelIds), isUnread: true };
};

const areLabelIdsEquivalent = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
) => {
  if (!left?.length && !right?.length) return true;
  if (!left || !right || left.length !== right.length) return false;

  const rightSet = new Set(right);
  for (const labelId of left) {
    if (!rightSet.has(labelId)) return false;
  }

  return true;
};

const applyMessageMetadata = (
  message: MessageListItem,
  next: { labelIds?: string[]; isUnread: boolean },
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

const toMessageMetadataById = (updates: readonly MessageMetadataMutationResult[]) =>
  new Map(updates.map((update) => [update.id, update] as const));

const applyMessageLabelChangesLocally = (
  message: MessageListItem,
  changes: { addLabelIds?: readonly string[]; removeLabelIds?: readonly string[] },
) => {
  const nextLabelIds = applyLabelIdChanges(message.labelIds, changes);

  return applyMessageMetadata(message, {
    labelIds: nextLabelIds,
    isUnread: isMessageUnread({ labelIds: nextLabelIds }),
  });
};

const getMessageSortTimestamp = (
  message: Pick<MessageListItem, "date" | "internalDate">,
): number => {
  const source = message.internalDate ?? message.date;
  if (!source) return 0;

  const numeric = Number(source);
  const parsedDate = Number.isFinite(numeric) ? new Date(numeric) : new Date(source);
  const timestamp = parsedDate.getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const applySyncDeltaToQueryData = (
  data: MessagesQueryData | undefined,
  updatedMessages: readonly MessageListItem[],
  removedMessageIds: readonly string[],
): MessagesQueryData | undefined => {
  if (!data?.pages.length) return data;

  const currentMessages = data.pages.flatMap((page) => page.messages);
  if (!currentMessages.length && updatedMessages.length === 0 && removedMessageIds.length === 0) {
    return data;
  }

  const updatedMessagesById = new Map(
    updatedMessages.map((message) => [message.id, message] as const),
  );
  const removedMessageIdsSet = new Set(removedMessageIds);
  const currentMessageOrder = new Map(
    currentMessages.map((message, index) => [message.id, index] as const),
  );
  const originalLoadedCount = currentMessages.length;
  const oldestLoadedMessage = currentMessages[currentMessages.length - 1];
  const oldestLoadedTimestamp =
    oldestLoadedMessage != null
      ? getMessageSortTimestamp(oldestLoadedMessage)
      : Number.NEGATIVE_INFINITY;

  const nextMessages = currentMessages
    .filter((message) => !removedMessageIdsSet.has(message.id))
    .map((message) => updatedMessagesById.get(message.id) ?? message);
  const nextMessageIds = new Set(nextMessages.map((message) => message.id));

  for (const updatedMessage of updatedMessages) {
    if (nextMessageIds.has(updatedMessage.id)) continue;

    if (
      nextMessages.length < originalLoadedCount ||
      getMessageSortTimestamp(updatedMessage) >= oldestLoadedTimestamp
    ) {
      nextMessages.push(updatedMessage);
      nextMessageIds.add(updatedMessage.id);
    }
  }

  nextMessages.sort((left, right) => {
    const timestampDifference = getMessageSortTimestamp(right) - getMessageSortTimestamp(left);
    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    const leftOrder = currentMessageOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = currentMessageOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });

  if (nextMessages.length > originalLoadedCount) {
    nextMessages.length = originalLoadedCount;
  }

  const nextPages: ListMessagesPageResult[] = [];
  const nextPageParams: Array<string | undefined> = [];
  let messageIndex = 0;

  for (const [pageIndex, page] of data.pages.entries()) {
    const pageSize = page.messages.length;
    const pageMessages = nextMessages.slice(messageIndex, messageIndex + pageSize);

    if (pageIndex > 0 && pageMessages.length === 0) {
      break;
    }

    nextPages.push({ ...page, messages: pageMessages });
    nextPageParams.push(data.pageParams[pageIndex]);
    messageIndex += pageMessages.length;
  }

  if (nextPages.length === 0) {
    nextPages.push({ ...data.pages[0], messages: [] });
    nextPageParams.push(data.pageParams[0]);
  }

  return {
    ...data,
    pages: nextPages,
    pageParams: nextPageParams,
  };
};

const fetchMessagesPage = async (
  mailbox: MailboxCategory,
  pageToken: string | undefined,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  return await trpc.gmail.listMessages.query(
    {
      category: mailbox,
      pageToken,
      maxResults: pageToken ? 25 : 50,
      query: normalizeSearchQuery(searchQuery),
    },
    { signal },
  );
};

export const refreshMessagesFirstPage = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const refreshedFirstPage = await fetchMessagesPage(mailbox, undefined, searchQuery, signal);
  queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, (data) =>
    replaceFirstPageInQueryData(data, refreshedFirstPage),
  );
  await persistQueryByKey(queryClient, messagesQueryKey);
  return refreshedFirstPage;
};

export const refreshLoadedMessagesPages = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const loadedPageCount = Math.max(currentMessages?.pages.length ?? 0, 1);

  const refreshedPages: ListMessagesPageResult[] = [];
  const refreshedPageParams: Array<string | undefined> = [];
  let pageToken: string | undefined;

  for (let pageIndex = 0; pageIndex < loadedPageCount; pageIndex += 1) {
    refreshedPageParams.push(pageToken);
    const refreshedPage = await fetchMessagesPage(mailbox, pageToken, searchQuery, signal);
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

const applyMailboxSyncDelta = async (
  queryClient: QueryClient,
  messagesQueryKey: ReturnType<typeof getMessagesQueryKey>,
  startHistoryId: string,
  updatedMessages: readonly MessageListItem[],
  removedMessageIds: readonly string[],
  nextHistoryId?: string,
) => {
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const removedMessageThreadIds = new Map<string, string>();

  for (const removedMessageId of removedMessageIds) {
    const removedMessage = findMessageInQueryData(currentMessages, removedMessageId);
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

  await persistQueryByKey(queryClient, messagesQueryKey);

  const touchedThreadQueryKeys = new Map<string, ReturnType<typeof getThreadQueryKey>>();

  for (const updatedMessage of updatedMessages) {
    const threadQueryKey = getThreadQueryKey(updatedMessage.threadId);
    touchedThreadQueryKeys.set(threadQueryKey.join("::"), threadQueryKey);
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, updatedMessage.id, () => updatedMessage),
    );
  }

  for (const removedMessageId of removedMessageIds) {
    const removedThreadId = removedMessageThreadIds.get(removedMessageId);
    if (!removedThreadId) continue;

    const threadQueryKey = getThreadQueryKey(removedThreadId);
    touchedThreadQueryKeys.set(threadQueryKey.join("::"), threadQueryKey);
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      removeMessageFromThreadData(currentData, removedMessageId),
    );
  }

  for (const threadQueryKey of touchedThreadQueryKeys.values()) {
    await persistQueryByKey(queryClient, threadQueryKey);
  }
};

export const syncMessages = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  if (normalizeSearchQuery(searchQuery)) {
    return await refreshMessagesFirstPage(queryClient, mailbox, searchQuery, signal);
  }

  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const currentMessages = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const startHistoryId = currentMessages?.pages[0]?.historyId;

  if (!currentMessages?.pages.length || !startHistoryId) {
    return await refreshLoadedMessagesPages(queryClient, mailbox, searchQuery, signal);
  }

  const syncDelta = await trpc.gmail.getMailboxSyncDelta.query(
    {
      category: mailbox,
      startHistoryId,
    },
    { signal },
  );

  if (syncDelta.requiresFullRefresh) {
    return await refreshLoadedMessagesPages(queryClient, mailbox, searchQuery, signal);
  }

  if (syncDelta.refreshFirstPage) {
    await refreshMessagesFirstPage(queryClient, mailbox, searchQuery, signal);
  }

  await applyMailboxSyncDelta(
    queryClient,
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

const updateSingleMessageMutation = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  mutation: (signal?: AbortSignal) => Promise<MessageMetadataMutationResult>,
  optimisticUpdater: (message: MessageListItem) => MessageListItem,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const previousData = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const messageToUpdate = findMessageInQueryData(previousData, messageId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(threadId) : null;
  const previousThreadData = threadQueryKey
    ? queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey)
    : undefined;

  queryClient.setQueryData(messagesQueryKey, (currentData: MessagesQueryData | undefined) =>
    updateMessageInQueryData(currentData, messageId, optimisticUpdater),
  );
  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, messageId, optimisticUpdater),
    );
  }

  await persistQueryByKey(queryClient, messagesQueryKey);
  if (threadQueryKey) await persistQueryByKey(queryClient, threadQueryKey);

  try {
    const updatedMessage = await mutation(signal);

    queryClient.setQueryData(messagesQueryKey, (currentData: MessagesQueryData | undefined) =>
      updateMessageInQueryData(currentData, messageId, (message) =>
        applyMessageMetadata(optimisticUpdater(message), {
          labelIds: updatedMessage.labelIds,
          isUnread: updatedMessage.isUnread,
        }),
      ),
    );

    if (threadQueryKey) {
      queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
        updateMessageInThreadData(currentData, messageId, (message) =>
          applyMessageMetadata(optimisticUpdater(message), {
            labelIds: updatedMessage.labelIds,
            isUnread: updatedMessage.isUnread,
          }),
        ),
      );
    }

    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) await persistQueryByKey(queryClient, threadQueryKey);
  } catch (error) {
    queryClient.setQueryData(messagesQueryKey, previousData);
    if (threadQueryKey) queryClient.setQueryData(threadQueryKey, previousThreadData);
    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) await persistQueryByKey(queryClient, threadQueryKey);
    throw error;
  }
};

export const markMessageAsReadInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  await updateSingleMessageMutation(
    queryClient,
    mailbox,
    searchQuery,
    messageId,
    async (mutationSignal) =>
      await trpc.gmail.markMessageAsRead.mutate({ messageId }, { signal: mutationSignal }),
    markMessageReadLocally,
    signal,
  );
};

export const markMessageAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  await updateSingleMessageMutation(
    queryClient,
    mailbox,
    searchQuery,
    messageId,
    async (mutationSignal) =>
      await trpc.gmail.markMessageAsUnread.mutate({ messageId }, { signal: mutationSignal }),
    markMessageUnreadLocally,
    signal,
  );
};

const updateThreadMutation = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  mutation: (signal?: AbortSignal) => Promise<ThreadMetadataMutationResult>,
  optimisticUpdater: (message: MessageListItem) => MessageListItem,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const threadQueryKey = getThreadQueryKey(threadId);
  const previousData = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const previousThreadData = queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey);

  queryClient.setQueryData(messagesQueryKey, (currentData: MessagesQueryData | undefined) =>
    updateMessagesInQueryData(
      currentData,
      (message) => message.threadId === threadId,
      optimisticUpdater,
    ),
  );
  queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
    updateMessagesInThreadData(currentData, () => true, optimisticUpdater),
  );

  await persistQueryByKey(queryClient, messagesQueryKey);
  await persistQueryByKey(queryClient, threadQueryKey);

  try {
    const updatedThread = await mutation(signal);
    const updatesById = toMessageMetadataById(updatedThread.messages);

    queryClient.setQueryData(messagesQueryKey, (currentData: MessagesQueryData | undefined) =>
      updateMessagesInQueryData(
        currentData,
        (message) => message.threadId === threadId,
        (message) => {
          const updatedMessage = updatesById.get(message.id);
          if (!updatedMessage) return optimisticUpdater(message);
          return applyMessageMetadata(optimisticUpdater(message), {
            labelIds: updatedMessage.labelIds,
            isUnread: updatedMessage.isUnread,
          });
        },
      ),
    );

    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessagesInThreadData(
        currentData,
        () => true,
        (message) => {
          const updatedMessage = updatesById.get(message.id);
          if (!updatedMessage) return optimisticUpdater(message);
          return applyMessageMetadata(optimisticUpdater(message), {
            labelIds: updatedMessage.labelIds,
            isUnread: updatedMessage.isUnread,
          });
        },
      ),
    );

    await persistQueryByKey(queryClient, messagesQueryKey);
    await persistQueryByKey(queryClient, threadQueryKey);
  } catch (error) {
    queryClient.setQueryData(messagesQueryKey, previousData);
    queryClient.setQueryData(threadQueryKey, previousThreadData);
    await persistQueryByKey(queryClient, messagesQueryKey);
    await persistQueryByKey(queryClient, threadQueryKey);
    throw error;
  }
};

export const markThreadAsReadInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await updateThreadMutation(
    queryClient,
    mailbox,
    searchQuery,
    threadId,
    async (mutationSignal) =>
      await trpc.gmail.markThreadAsRead.mutate({ threadId }, { signal: mutationSignal }),
    markMessageReadLocally,
    signal,
  );
};

export const markThreadAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await updateThreadMutation(
    queryClient,
    mailbox,
    searchQuery,
    threadId,
    async (mutationSignal) =>
      await trpc.gmail.markThreadAsUnread.mutate({ threadId }, { signal: mutationSignal }),
    markMessageUnreadLocally,
    signal,
  );
};

export const updateMessageLabelsInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const previousData = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const messageToUpdate = findMessageInQueryData(previousData, messageId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(threadId) : null;
  const previousThreadData = threadQueryKey
    ? queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey)
    : undefined;

  queryClient.setQueryData(messagesQueryKey, (currentData: MessagesQueryData | undefined) =>
    updateMessageInQueryData(currentData, messageId, (message) =>
      applyMessageLabelChangesLocally(message, changes),
    ),
  );
  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, messageId, (message) =>
        applyMessageLabelChangesLocally(message, changes),
      ),
    );
  }

  await persistQueryByKey(queryClient, messagesQueryKey);
  if (threadQueryKey) await persistQueryByKey(queryClient, threadQueryKey);

  try {
    const updatedMessage = await trpc.gmail.updateMessageLabels.mutate(
      {
        messageId,
        addLabelIds: changes.addLabelIds,
        removeLabelIds: changes.removeLabelIds,
      },
      { signal },
    );

    queryClient.setQueryData(messagesQueryKey, (currentData: MessagesQueryData | undefined) =>
      updateMessageInQueryData(currentData, messageId, (message) =>
        applyMessageMetadata(message, {
          labelIds: updatedMessage.labelIds,
          isUnread: updatedMessage.isUnread,
        }),
      ),
    );

    if (threadQueryKey) {
      queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
        updateMessageInThreadData(currentData, messageId, (message) =>
          applyMessageMetadata(message, {
            labelIds: updatedMessage.labelIds,
            isUnread: updatedMessage.isUnread,
          }),
        ),
      );
    }

    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) await persistQueryByKey(queryClient, threadQueryKey);
  } catch (error) {
    queryClient.setQueryData(messagesQueryKey, previousData);
    if (threadQueryKey) queryClient.setQueryData(threadQueryKey, previousThreadData);
    await persistQueryByKey(queryClient, messagesQueryKey);
    if (threadQueryKey) await persistQueryByKey(queryClient, threadQueryKey);
    throw error;
  }
};

export const moveMessageToTrashInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const currentData = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const messageToUpdate = findMessageInQueryData(currentData, messageId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(threadId) : null;

  const updatedMessage = await trpc.gmail.moveMessageToTrash.mutate({ messageId }, { signal });

  queryClient.setQueryData(messagesQueryKey, (data: MessagesQueryData | undefined) =>
    removeMessageFromQueryData(data, messageId),
  );
  await persistQueryByKey(queryClient, messagesQueryKey);

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (data: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(data, messageId, (message) =>
        applyMessageMetadata(message, {
          labelIds: updatedMessage.labelIds,
          isUnread: updatedMessage.isUnread,
        }),
      ),
    );
    await persistQueryByKey(queryClient, threadQueryKey);
  }
};

export const deleteMessagePermanentlyInMailbox = async (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailbox, searchQuery);
  const currentData = queryClient.getQueryData<MessagesQueryData>(messagesQueryKey);
  const messageToUpdate = findMessageInQueryData(currentData, messageId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(threadId) : null;

  await trpc.gmail.deleteMessagePermanently.mutate({ messageId }, { signal });

  queryClient.setQueryData(messagesQueryKey, (data: MessagesQueryData | undefined) =>
    removeMessageFromQueryData(data, messageId),
  );
  await persistQueryByKey(queryClient, messagesQueryKey);

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (data: ThreadMessagesResult | undefined) =>
      removeMessageFromThreadData(data, messageId),
    );
    await persistQueryByKey(queryClient, threadQueryKey);
  }
};

export const messagesQueryOptions = (
  _queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  enabled = true,
) => ({
  queryKey: getMessagesQueryKey(mailbox, searchQuery),
  queryFn: (ctx: { pageParam: unknown; signal: AbortSignal }) => {
    return fetchMessagesPage(mailbox, parsePageToken(ctx.pageParam), searchQuery, ctx.signal);
  },
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage: ListMessagesPageResult) => lastPage.nextPageToken ?? undefined,
  staleTime: GMAIL_QUERY_STALE_TIME_MS,
  enabled,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export const liveSyncQueryOptions = (
  queryClient: QueryClient,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  enabled = true,
) =>
  queryOptions({
    queryKey: getLiveSyncQueryKey(mailbox, searchQuery),
    queryFn: ({ signal }) => syncMessages(queryClient, mailbox, searchQuery, signal),
    enabled,
    initialData: () =>
      queryClient.getQueryData<MessagesQueryData>(getMessagesQueryKey(mailbox, searchQuery))
        ?.pages[0],
    persister: undefined,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
