import type { QueryClient } from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
import { rateLimitedErrorDataSchema } from "@quieter/orpc/errors";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { persistQueryByKey } from "~/lib/query-persister";
import {
  addUnreadLabel,
  applyLabelIdChanges,
  GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS,
  GMAIL_QUERY_STALE_TIME_MS,
  isMessageInMailbox,
  isMessageUnread,
  MAILBOX_LABELS,
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

const getRateLimitedRetryAfterMs = (error: unknown) => {
  if (!(error instanceof ORPCError) || error.code !== "RATE_LIMITED") {
    return undefined;
  }

  const parsedErrorData = rateLimitedErrorDataSchema.safeParse(error.data);
  if (!parsedErrorData.success) {
    return undefined;
  }

  return parsedErrorData.data.retryAfter * 1000;
};

const getRateLimitCooldownRemainingMs = (query: {
  state: { error: unknown; errorUpdatedAt: number };
}) => {
  const retryAfterMs = getRateLimitedRetryAfterMs(query.state.error);
  if (retryAfterMs == null) {
    return undefined;
  }

  return Math.max(0, query.state.errorUpdatedAt + retryAfterMs - Date.now());
};

const isNonRetryableMailboxError = (error: unknown) => {
  return (
    error instanceof ORPCError &&
    ["FORBIDDEN", "MAILBOX_SCOPE_REPAIR_REQUIRED", "NOT_FOUND", "UNAUTHORIZED"].includes(error.code)
  );
};

const shouldRetryGmailQuery = (failureCount: number, error: unknown) => {
  return (
    !isNonRetryableMailboxError(error) &&
    getRateLimitedRetryAfterMs(error) == null &&
    failureCount < 3
  );
};

export const getMessagesQueryKey = (
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
) => ["messages", mailboxId, mailbox, normalizeSearchQuery(searchQuery) ?? ""] as const;

export const getLiveSyncQueryKey = (
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
) => [...getMessagesQueryKey(mailboxId, mailbox, searchQuery), "live-sync"] as const;

type MessagesQueryData = {
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

type MessagesQuerySnapshot = {
  queryKey: ReturnType<typeof getMessagesQueryKey>;
  data: MessagesQueryData | undefined;
};

type ThreadQuerySnapshot = {
  queryKey: ReturnType<typeof getThreadQueryKey>;
  data: ThreadMessagesResult | undefined;
};

type CachedMessagesQuery = MessagesQuerySnapshot & {
  mailbox: MailboxCategory;
  searchQuery?: string;
};

const MARK_AS_SPAM_LABEL_CHANGES = {
  addLabelIds: [MAILBOX_LABELS.spam],
  removeLabelIds: [MAILBOX_LABELS.inbox],
} as const;

const UNMARK_AS_SPAM_LABEL_CHANGES = {
  addLabelIds: [MAILBOX_LABELS.inbox],
  removeLabelIds: [MAILBOX_LABELS.spam],
} as const;

const MOVE_TO_TRASH_LABEL_CHANGES = {
  addLabelIds: [MAILBOX_LABELS.trash],
  removeLabelIds: [
    MAILBOX_LABELS.inbox,
    MAILBOX_LABELS.spam,
    MAILBOX_LABELS.sent,
    MAILBOX_LABELS.drafts,
  ],
} as const;

const REMOVE_FROM_TRASH_LABEL_CHANGES = {
  addLabelIds: [MAILBOX_LABELS.inbox],
  removeLabelIds: [MAILBOX_LABELS.trash],
} as const;

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
  if (!data?.pages || !Array.isArray(data.pages)) return undefined;

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
  return removeMessagesFromQueryData(data, (message) => message.id === messageId);
};

const removeMessagesFromQueryData = (
  data: MessagesQueryData | undefined,
  predicate: (message: MessageListItem) => boolean,
): MessagesQueryData | undefined => {
  if (!data) return data;

  let hasChanges = false;
  const pages = data.pages.map((page) => {
    const messages = page.messages.filter((message) => !predicate(message));
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
  return removeMessagesFromThreadData(data, (message) => message.id === messageId);
};

const removeMessagesFromThreadData = (
  data: ThreadMessagesResult | undefined,
  predicate: (message: MessageListItem) => boolean,
): ThreadMessagesResult | undefined => {
  if (!data) return data;
  const messages = data.messages.filter((message) => !predicate(message));
  return messages.length === data.messages.length ? data : { ...data, messages };
};

const isMessagesQueryData = (value: unknown): value is MessagesQueryData => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const pages = Reflect.get(value, "pages");
  const pageParams = Reflect.get(value, "pageParams");
  return Array.isArray(pages) && Array.isArray(pageParams);
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

const moveMessageToTrashLocally = (message: MessageListItem) =>
  applyMessageLabelChangesLocally(message, MOVE_TO_TRASH_LABEL_CHANGES);

const removeMessageFromTrashLocally = (message: MessageListItem) =>
  applyMessageLabelChangesLocally(message, REMOVE_FROM_TRASH_LABEL_CHANGES);

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
  const targetLoadedCount =
    originalLoadedCount === 0 ? updatedMessages.length : originalLoadedCount;
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

  if (nextMessages.length > targetLoadedCount) {
    nextMessages.length = targetLoadedCount;
  }

  const nextPages: ListMessagesPageResult[] = [];
  const nextPageParams: Array<string | undefined> = [];
  let messageIndex = 0;

  for (const [pageIndex, page] of data.pages.entries()) {
    const pageSize =
      page.messages.length > 0 || pageIndex > 0 ? page.messages.length : targetLoadedCount;
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

const isMailboxCategory = (value: unknown): value is MailboxCategory =>
  value === "inbox" ||
  value === "spam" ||
  value === "sent" ||
  value === "trash" ||
  value === "drafts";

const getCachedMessagesQueries = (
  queryClient: QueryClient,
  mailboxId: string,
): CachedMessagesQuery[] => {
  return queryClient
    .getQueriesData<MessagesQueryData>({ queryKey: ["messages", mailboxId] })
    .flatMap(([queryKey, data]) => {
      const [scope, queryMailboxId, mailbox, rawSearchQuery] = queryKey;

      if (
        queryKey.length !== 4 ||
        scope !== "messages" ||
        queryMailboxId !== mailboxId ||
        !isMailboxCategory(mailbox) ||
        typeof rawSearchQuery !== "string" ||
        (data !== undefined && !isMessagesQueryData(data))
      ) {
        return [];
      }

      return [
        {
          queryKey: getMessagesQueryKey(mailboxId, mailbox, rawSearchQuery),
          mailbox,
          searchQuery: normalizeSearchQuery(rawSearchQuery),
          data,
        },
      ];
    });
};

const snapshotMessagesQueries = (
  queryClient: QueryClient,
  mailboxId: string,
): MessagesQuerySnapshot[] => {
  return getCachedMessagesQueries(queryClient, mailboxId).map(({ queryKey, data }) => ({
    queryKey,
    data,
  }));
};

const snapshotThreadQuery = (
  queryClient: QueryClient,
  threadQueryKey: ReturnType<typeof getThreadQueryKey>,
): ThreadQuerySnapshot => ({
  queryKey: threadQueryKey,
  data: queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey),
});

const restoreMessagesQueries = (
  queryClient: QueryClient,
  snapshots: readonly MessagesQuerySnapshot[],
) => {
  for (const snapshot of snapshots) {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data);
  }
};

const persistQueryKeys = async (
  queryClient: QueryClient,
  queryKeys: ReadonlyArray<readonly unknown[]>,
) => {
  const seenQueryKeys = new Set<string>();

  for (const queryKey of queryKeys) {
    const queryKeyId = queryKey.join("::");
    if (seenQueryKeys.has(queryKeyId)) continue;
    seenQueryKeys.add(queryKeyId);
    await persistQueryByKey(queryClient, queryKey);
  }
};

const findMessageInCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  messageId: string,
) => {
  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const message = findMessageInQueryData(cachedQuery.data, messageId);
    if (message) {
      return message;
    }
  }

  return undefined;
};

const reconcileMessageInCachedMailboxQuery = (
  cachedQuery: CachedMessagesQuery,
  nextMessage: MessageListItem,
): MessagesQueryData | undefined => {
  const currentMessage = findMessageInQueryData(cachedQuery.data, nextMessage.id);

  if (currentMessage) {
    if (!isMessageInMailbox(nextMessage, cachedQuery.mailbox)) {
      return removeMessageFromQueryData(cachedQuery.data, nextMessage.id);
    }

    return updateMessageInQueryData(cachedQuery.data, nextMessage.id, () => nextMessage);
  }

  if (cachedQuery.searchQuery || !isMessageInMailbox(nextMessage, cachedQuery.mailbox)) {
    return cachedQuery.data;
  }

  return applySyncDeltaToQueryData(cachedQuery.data, [nextMessage], []);
};

const applyMessageToCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  nextMessage: MessageListItem,
) => {
  const touchedQueryKeys: Array<ReturnType<typeof getMessagesQueryKey>> = [];

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const nextData = reconcileMessageInCachedMailboxQuery(cachedQuery, nextMessage);
    if (nextData === cachedQuery.data) continue;

    queryClient.setQueryData(cachedQuery.queryKey, nextData);
    touchedQueryKeys.push(cachedQuery.queryKey);
  }

  return touchedQueryKeys;
};

const updateMessagesInCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean,
  updater: (message: MessageListItem) => MessageListItem,
) => {
  const touchedQueryKeys: Array<ReturnType<typeof getMessagesQueryKey>> = [];

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const nextData = updateMessagesInQueryData(cachedQuery.data, predicate, updater);
    if (nextData === cachedQuery.data) continue;

    queryClient.setQueryData(cachedQuery.queryKey, nextData);
    touchedQueryKeys.push(cachedQuery.queryKey);
  }

  return touchedQueryKeys;
};

const removeMessageFromCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  messageId: string,
) => {
  return removeMessagesFromCachedMailboxQueries(
    queryClient,
    mailboxId,
    (message) => message.id === messageId,
  );
};

const removeMessagesFromCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean,
) => {
  const touchedQueryKeys: Array<ReturnType<typeof getMessagesQueryKey>> = [];

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const nextData = removeMessagesFromQueryData(cachedQuery.data, predicate);
    if (nextData === cachedQuery.data) continue;

    queryClient.setQueryData(cachedQuery.queryKey, nextData);
    touchedQueryKeys.push(cachedQuery.queryKey);
  }

  return touchedQueryKeys;
};

const applyResolvedThreadMetadataToCaches = async (
  queryClient: QueryClient,
  mailboxId: string,
  updatedThread: ThreadMetadataMutationResult,
) => {
  const threadQueryKey = getThreadQueryKey(mailboxId, updatedThread.threadId);
  const updatesById = toMessageMetadataById(updatedThread.messages);
  const touchedQueryKeys: Array<readonly unknown[]> = [];

  for (const updatedMessage of updatedThread.messages) {
    const previousMessage = findMessageInCachedMailboxQueries(
      queryClient,
      mailboxId,
      updatedMessage.id,
    );
    if (!previousMessage) continue;

    const resolvedMessage = applyMessageMetadata(previousMessage, {
      labelIds: updatedMessage.labelIds,
      isUnread: updatedMessage.isUnread,
    });
    touchedQueryKeys.push(
      ...applyMessageToCachedMailboxQueries(queryClient, mailboxId, resolvedMessage),
    );
    prefetchNewMailboxQueries(queryClient, mailboxId, previousMessage, resolvedMessage);
  }

  queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
    updateMessagesInThreadData(
      currentData,
      (message) => updatesById.has(message.id),
      (message) => {
        const nextMessage = updatesById.get(message.id);
        if (!nextMessage) return message;
        return applyMessageMetadata(message, {
          labelIds: nextMessage.labelIds,
          isUnread: nextMessage.isUnread,
        });
      },
    ),
  );

  await persistQueryKeys(queryClient, [...touchedQueryKeys, threadQueryKey]);
};

const prefetchNewMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  previousMessage: MessageListItem,
  nextMessage: MessageListItem,
) => {
  for (const mailbox of ["inbox", "spam", "sent", "trash", "drafts"] satisfies MailboxCategory[]) {
    if (
      !isMessageInMailbox(nextMessage, mailbox) ||
      isMessageInMailbox(previousMessage, mailbox) ||
      queryClient.getQueryData<MessagesQueryData>(getMessagesQueryKey(mailboxId, mailbox))?.pages
        .length
    ) {
      continue;
    }

    void queryClient.prefetchInfiniteQuery(messagesQueryOptions(mailboxId, mailbox));
  }
};

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

export const refreshMessagesFirstPage = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const refreshedFirstPage = await fetchMessagesPage(
    mailboxId,
    mailbox,
    undefined,
    searchQuery,
    signal,
  );
  queryClient.setQueryData<MessagesQueryData>(messagesQueryKey, (data) =>
    replaceFirstPageInQueryData(data, refreshedFirstPage),
  );
  await persistQueryByKey(queryClient, messagesQueryKey);
  return refreshedFirstPage;
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

  queryClient.setQueryData<MessagesQueryData>(
    messagesQueryKey,
    toLoadedPagesData(refreshedPages, refreshedPageParams),
  );
  await persistQueryByKey(queryClient, messagesQueryKey);
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
    const threadQueryKey = getThreadQueryKey(mailboxId, updatedMessage.threadId);
    touchedThreadQueryKeys.set(threadQueryKey.join("::"), threadQueryKey);
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, updatedMessage.id, () => updatedMessage),
    );
  }

  for (const removedMessageId of removedMessageIds) {
    const removedThreadId = removedMessageThreadIds.get(removedMessageId);
    if (!removedThreadId) continue;

    const threadQueryKey = getThreadQueryKey(mailboxId, removedThreadId);
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
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
  signal?: AbortSignal,
) => {
  if (mailbox === "drafts") {
    return await refreshLoadedMessagesPages(queryClient, mailboxId, mailbox, searchQuery, signal);
  }

  if (normalizeSearchQuery(searchQuery)) {
    return await refreshMessagesFirstPage(queryClient, mailboxId, mailbox, searchQuery, signal);
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

  if (syncDelta.refreshFirstPage) {
    await refreshMessagesFirstPage(queryClient, mailboxId, mailbox, searchQuery, signal);
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

const updateSingleMessageMutation = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  mutation: (signal?: AbortSignal) => Promise<MessageMetadataMutationResult>,
  optimisticUpdater: (message: MessageListItem) => MessageListItem,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const messageToUpdate =
    findMessageInQueryData(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey),
      messageId,
    ) ?? findMessageInCachedMailboxQueries(queryClient, mailboxId, messageId);

  if (!messageToUpdate) {
    await mutation(signal);
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(queryClient, mailboxId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(mailboxId, threadId) : null;
  const previousThreadQuery = threadQueryKey
    ? snapshotThreadQuery(queryClient, threadQueryKey)
    : null;
  const optimisticMessage = optimisticUpdater(messageToUpdate);

  const optimisticTouchedQueryKeys = applyMessageToCachedMailboxQueries(
    queryClient,
    mailboxId,
    optimisticMessage,
  );
  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, messageId, (message) =>
        applyMessageMetadata(message, {
          labelIds: optimisticMessage.labelIds,
          isUnread: optimisticMessage.isUnread ?? false,
        }),
      ),
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey ? [...optimisticTouchedQueryKeys, threadQueryKey] : optimisticTouchedQueryKeys,
  );

  try {
    const updatedMessage = await mutation(signal);
    const resolvedMessage = applyMessageMetadata(optimisticMessage, {
      labelIds: updatedMessage.labelIds,
      isUnread: updatedMessage.isUnread,
    });

    const resolvedTouchedQueryKeys = applyMessageToCachedMailboxQueries(
      queryClient,
      mailboxId,
      resolvedMessage,
    );
    prefetchNewMailboxQueries(queryClient, mailboxId, messageToUpdate, resolvedMessage);

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

    await persistQueryKeys(
      queryClient,
      threadQueryKey ? [...resolvedTouchedQueryKeys, threadQueryKey] : resolvedTouchedQueryKeys,
    );
  } catch (error) {
    restoreMessagesQueries(queryClient, previousMessagesQueries);
    if (previousThreadQuery) {
      queryClient.setQueryData(previousThreadQuery.queryKey, previousThreadQuery.data);
    }
    await persistQueryKeys(
      queryClient,
      previousThreadQuery
        ? [
            ...previousMessagesQueries.map((snapshot) => snapshot.queryKey),
            previousThreadQuery.queryKey,
          ]
        : previousMessagesQueries.map((snapshot) => snapshot.queryKey),
    );
    throw error;
  }
};

export const markMessageAsReadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  await updateSingleMessageMutation(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    async (mutationSignal) =>
      await rpc.mail.markMessageAsRead({ mailboxId, messageId }, { signal: mutationSignal }),
    markMessageReadLocally,
    signal,
  );
};

export const markMessageAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  await updateSingleMessageMutation(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    async (mutationSignal) =>
      await rpc.mail.markMessageAsUnread({ mailboxId, messageId }, { signal: mutationSignal }),
    markMessageUnreadLocally,
    signal,
  );
};

const updateThreadMutation = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  mutation: (signal?: AbortSignal) => Promise<ThreadMetadataMutationResult>,
  optimisticUpdater: (message: MessageListItem) => MessageListItem,
  signal?: AbortSignal,
) => {
  const threadQueryKey = getThreadQueryKey(mailboxId, threadId);
  const previousMessagesQueries = snapshotMessagesQueries(queryClient, mailboxId);
  const previousThreadQuery = snapshotThreadQuery(queryClient, threadQueryKey);

  const optimisticTouchedQueryKeys = updateMessagesInCachedMailboxQueries(
    queryClient,
    mailboxId,
    (message) => message.threadId === threadId,
    optimisticUpdater,
  );
  queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
    updateMessagesInThreadData(currentData, () => true, optimisticUpdater),
  );

  await persistQueryKeys(queryClient, [...optimisticTouchedQueryKeys, threadQueryKey]);

  try {
    const updatedThread = await mutation(signal);
    const updatesById = toMessageMetadataById(updatedThread.messages);

    const resolvedTouchedQueryKeys = updateMessagesInCachedMailboxQueries(
      queryClient,
      mailboxId,
      (message) => updatesById.has(message.id),
      (message) => {
        const updatedMessage = updatesById.get(message.id);
        if (!updatedMessage) return message;
        return applyMessageMetadata(message, {
          labelIds: updatedMessage.labelIds,
          isUnread: updatedMessage.isUnread,
        });
      },
    );

    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessagesInThreadData(
        currentData,
        (message) => updatesById.has(message.id),
        (message) => {
          const updatedMessage = updatesById.get(message.id);
          if (!updatedMessage) return message;
          return applyMessageMetadata(message, {
            labelIds: updatedMessage.labelIds,
            isUnread: updatedMessage.isUnread,
          });
        },
      ),
    );

    await persistQueryKeys(queryClient, [...resolvedTouchedQueryKeys, threadQueryKey]);
  } catch (error) {
    restoreMessagesQueries(queryClient, previousMessagesQueries);
    queryClient.setQueryData(previousThreadQuery.queryKey, previousThreadQuery.data);
    await persistQueryKeys(queryClient, [
      ...previousMessagesQueries.map((snapshot) => snapshot.queryKey),
      previousThreadQuery.queryKey,
    ]);
    throw error;
  }
};

export const markThreadAsReadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await updateThreadMutation(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    threadId,
    async (mutationSignal) =>
      await rpc.mail.markThreadAsRead({ mailboxId, threadId }, { signal: mutationSignal }),
    markMessageReadLocally,
    signal,
  );
};

export const markThreadAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await updateThreadMutation(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    threadId,
    async (mutationSignal) =>
      await rpc.mail.markThreadAsUnread({ mailboxId, threadId }, { signal: mutationSignal }),
    markMessageUnreadLocally,
    signal,
  );
};

export const updateThreadLabelsInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal,
) => {
  const updatedThread = await rpc.mail.updateThreadLabels(
    {
      mailboxId,
      threadId,
      addLabelIds: changes.addLabelIds,
      removeLabelIds: changes.removeLabelIds,
    },
    { signal },
  );

  await applyResolvedThreadMetadataToCaches(queryClient, mailboxId, updatedThread);
};

export const updateMessageLabelsInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const messageToUpdate =
    findMessageInQueryData(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey),
      messageId,
    ) ?? findMessageInCachedMailboxQueries(queryClient, mailboxId, messageId);

  if (!messageToUpdate) {
    await rpc.mail.updateMessageLabels(
      {
        mailboxId,
        messageId,
        addLabelIds: changes.addLabelIds,
        removeLabelIds: changes.removeLabelIds,
      },
      { signal },
    );
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(queryClient, mailboxId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(mailboxId, threadId) : null;
  const previousThreadQuery = threadQueryKey
    ? snapshotThreadQuery(queryClient, threadQueryKey)
    : null;
  const optimisticMessage = applyMessageLabelChangesLocally(messageToUpdate, changes);

  const optimisticTouchedQueryKeys = applyMessageToCachedMailboxQueries(
    queryClient,
    mailboxId,
    optimisticMessage,
  );
  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, messageId, (message) =>
        applyMessageMetadata(message, {
          labelIds: optimisticMessage.labelIds,
          isUnread: optimisticMessage.isUnread ?? false,
        }),
      ),
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey ? [...optimisticTouchedQueryKeys, threadQueryKey] : optimisticTouchedQueryKeys,
  );

  try {
    const updatedMessage = await rpc.mail.updateMessageLabels(
      {
        mailboxId,
        messageId,
        addLabelIds: changes.addLabelIds,
        removeLabelIds: changes.removeLabelIds,
      },
      { signal },
    );
    const resolvedMessage = applyMessageMetadata(optimisticMessage, {
      labelIds: updatedMessage.labelIds,
      isUnread: updatedMessage.isUnread,
    });

    const resolvedTouchedQueryKeys = applyMessageToCachedMailboxQueries(
      queryClient,
      mailboxId,
      resolvedMessage,
    );
    prefetchNewMailboxQueries(queryClient, mailboxId, messageToUpdate, resolvedMessage);

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

    await persistQueryKeys(
      queryClient,
      threadQueryKey ? [...resolvedTouchedQueryKeys, threadQueryKey] : resolvedTouchedQueryKeys,
    );
  } catch (error) {
    restoreMessagesQueries(queryClient, previousMessagesQueries);
    if (previousThreadQuery) {
      queryClient.setQueryData(previousThreadQuery.queryKey, previousThreadQuery.data);
    }
    await persistQueryKeys(
      queryClient,
      previousThreadQuery
        ? [
            ...previousMessagesQueries.map((snapshot) => snapshot.queryKey),
            previousThreadQuery.queryKey,
          ]
        : previousMessagesQueries.map((snapshot) => snapshot.queryKey),
    );
    throw error;
  }
};

export const markMessageAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  await updateMessageLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    {
      addLabelIds: [...MARK_AS_SPAM_LABEL_CHANGES.addLabelIds],
      removeLabelIds: [...MARK_AS_SPAM_LABEL_CHANGES.removeLabelIds],
    },
    signal,
  );
};

export const markThreadAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await updateThreadLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    threadId,
    {
      addLabelIds: [...MARK_AS_SPAM_LABEL_CHANGES.addLabelIds],
      removeLabelIds: [...MARK_AS_SPAM_LABEL_CHANGES.removeLabelIds],
    },
    signal,
  );
};

export const unmarkMessageAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  await updateMessageLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    {
      addLabelIds: [...UNMARK_AS_SPAM_LABEL_CHANGES.addLabelIds],
      removeLabelIds: [...UNMARK_AS_SPAM_LABEL_CHANGES.removeLabelIds],
    },
    signal,
  );
};

export const unmarkThreadAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await updateThreadLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    threadId,
    {
      addLabelIds: [...UNMARK_AS_SPAM_LABEL_CHANGES.addLabelIds],
      removeLabelIds: [...UNMARK_AS_SPAM_LABEL_CHANGES.removeLabelIds],
    },
    signal,
  );
};

export const moveMessageToTrashInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const messageToUpdate =
    findMessageInQueryData(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey),
      messageId,
    ) ?? findMessageInCachedMailboxQueries(queryClient, mailboxId, messageId);

  if (!messageToUpdate) {
    await rpc.mail.moveMessageToTrash({ mailboxId, messageId }, { signal });
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(queryClient, mailboxId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(mailboxId, threadId) : null;
  const previousThreadQuery = threadQueryKey
    ? snapshotThreadQuery(queryClient, threadQueryKey)
    : null;
  const optimisticMessage = moveMessageToTrashLocally(messageToUpdate);

  const optimisticTouchedQueryKeys = applyMessageToCachedMailboxQueries(
    queryClient,
    mailboxId,
    optimisticMessage,
  );

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, messageId, (message) =>
        applyMessageMetadata(message, {
          labelIds: optimisticMessage.labelIds,
          isUnread: optimisticMessage.isUnread ?? false,
        }),
      ),
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey ? [...optimisticTouchedQueryKeys, threadQueryKey] : optimisticTouchedQueryKeys,
  );

  try {
    const updatedMessage = await rpc.mail.moveMessageToTrash({ mailboxId, messageId }, { signal });
    const resolvedMessage = applyMessageMetadata(optimisticMessage, {
      labelIds: updatedMessage.labelIds,
      isUnread: updatedMessage.isUnread,
    });

    const resolvedTouchedQueryKeys = applyMessageToCachedMailboxQueries(
      queryClient,
      mailboxId,
      resolvedMessage,
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

    await persistQueryKeys(
      queryClient,
      threadQueryKey ? [...resolvedTouchedQueryKeys, threadQueryKey] : resolvedTouchedQueryKeys,
    );
  } catch (error) {
    restoreMessagesQueries(queryClient, previousMessagesQueries);
    if (previousThreadQuery) {
      queryClient.setQueryData(previousThreadQuery.queryKey, previousThreadQuery.data);
    }
    await persistQueryKeys(
      queryClient,
      previousThreadQuery
        ? [
            ...previousMessagesQueries.map((snapshot) => snapshot.queryKey),
            previousThreadQuery.queryKey,
          ]
        : previousMessagesQueries.map((snapshot) => snapshot.queryKey),
    );
    throw error;
  }
};

export const untrashMessageInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const messageToUpdate =
    findMessageInQueryData(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey),
      messageId,
    ) ?? findMessageInCachedMailboxQueries(queryClient, mailboxId, messageId);

  if (!messageToUpdate) {
    await rpc.mail.updateMessageLabels(
      {
        mailboxId,
        messageId,
        addLabelIds: [...REMOVE_FROM_TRASH_LABEL_CHANGES.addLabelIds],
        removeLabelIds: [...REMOVE_FROM_TRASH_LABEL_CHANGES.removeLabelIds],
      },
      { signal },
    );
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(queryClient, mailboxId);
  const threadId = messageToUpdate.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(mailboxId, threadId) : null;
  const previousThreadQuery = threadQueryKey
    ? snapshotThreadQuery(queryClient, threadQueryKey)
    : null;
  const optimisticMessage = removeMessageFromTrashLocally(messageToUpdate);

  const optimisticTouchedQueryKeys = applyMessageToCachedMailboxQueries(
    queryClient,
    mailboxId,
    optimisticMessage,
  );

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, messageId, (message) =>
        applyMessageMetadata(message, {
          labelIds: optimisticMessage.labelIds,
          isUnread: optimisticMessage.isUnread ?? false,
        }),
      ),
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey ? [...optimisticTouchedQueryKeys, threadQueryKey] : optimisticTouchedQueryKeys,
  );

  try {
    const updatedMessage = await rpc.mail.updateMessageLabels(
      {
        mailboxId,
        messageId,
        addLabelIds: [...REMOVE_FROM_TRASH_LABEL_CHANGES.addLabelIds],
        removeLabelIds: [...REMOVE_FROM_TRASH_LABEL_CHANGES.removeLabelIds],
      },
      { signal },
    );
    const resolvedMessage = applyMessageMetadata(optimisticMessage, {
      labelIds: updatedMessage.labelIds,
      isUnread: updatedMessage.isUnread,
    });

    const resolvedTouchedQueryKeys = applyMessageToCachedMailboxQueries(
      queryClient,
      mailboxId,
      resolvedMessage,
    );
    prefetchNewMailboxQueries(queryClient, mailboxId, messageToUpdate, resolvedMessage);

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

    await persistQueryKeys(
      queryClient,
      threadQueryKey ? [...resolvedTouchedQueryKeys, threadQueryKey] : resolvedTouchedQueryKeys,
    );
  } catch (error) {
    restoreMessagesQueries(queryClient, previousMessagesQueries);
    if (previousThreadQuery) {
      queryClient.setQueryData(previousThreadQuery.queryKey, previousThreadQuery.data);
    }
    await persistQueryKeys(
      queryClient,
      previousThreadQuery
        ? [
            ...previousMessagesQueries.map((snapshot) => snapshot.queryKey),
            previousThreadQuery.queryKey,
          ]
        : previousMessagesQueries.map((snapshot) => snapshot.queryKey),
    );
    throw error;
  }
};

export const untrashThreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  const updatedThread = await rpc.mail.untrashThread({ mailboxId, threadId }, { signal });
  await applyResolvedThreadMetadataToCaches(queryClient, mailboxId, updatedThread);
};

export const moveThreadToTrashInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  const updatedThread = await rpc.mail.moveThreadToTrash({ mailboxId, threadId }, { signal });
  await applyResolvedThreadMetadataToCaches(queryClient, mailboxId, updatedThread);
};

export const deleteMessagePermanentlyInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const messageToUpdate =
    findMessageInQueryData(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey),
      messageId,
    ) ?? findMessageInCachedMailboxQueries(queryClient, mailboxId, messageId);

  if (!messageToUpdate) {
    await rpc.mail.deleteMessagePermanently({ mailboxId, messageId }, { signal });
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(queryClient, mailboxId);
  const threadId = messageToUpdate?.threadId;
  const threadQueryKey = threadId ? getThreadQueryKey(mailboxId, threadId) : null;
  const previousThreadQuery = threadQueryKey
    ? snapshotThreadQuery(queryClient, threadQueryKey)
    : null;

  const optimisticTouchedQueryKeys = removeMessageFromCachedMailboxQueries(
    queryClient,
    mailboxId,
    messageId,
  );

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      removeMessageFromThreadData(currentData, messageId),
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey ? [...optimisticTouchedQueryKeys, threadQueryKey] : optimisticTouchedQueryKeys,
  );

  try {
    await rpc.mail.deleteMessagePermanently({ mailboxId, messageId }, { signal });
  } catch (error) {
    restoreMessagesQueries(queryClient, previousMessagesQueries);
    if (previousThreadQuery) {
      queryClient.setQueryData(previousThreadQuery.queryKey, previousThreadQuery.data);
    }
    await persistQueryKeys(
      queryClient,
      previousThreadQuery
        ? [
            ...previousMessagesQueries.map((snapshot) => snapshot.queryKey),
            previousThreadQuery.queryKey,
          ]
        : previousMessagesQueries.map((snapshot) => snapshot.queryKey),
    );
    throw error;
  }
};

export const deleteThreadPermanentlyInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await rpc.mail.deleteThreadPermanently({ mailboxId, threadId }, { signal });

  const threadQueryKey = getThreadQueryKey(mailboxId, threadId);
  const touchedQueryKeys = removeMessagesFromCachedMailboxQueries(
    queryClient,
    mailboxId,
    (message) => message.threadId === threadId,
  );
  queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
    removeMessagesFromThreadData(currentData, () => true),
  );

  await persistQueryKeys(queryClient, [...touchedQueryKeys, threadQueryKey]);
};

export const deleteDraftInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  draftId: string,
  signal?: AbortSignal,
) => {
  const messagesQueryKey = getMessagesQueryKey(mailboxId, mailbox, searchQuery);
  const messageToUpdate =
    findMessageInQueryData(
      queryClient.getQueryData<MessagesQueryData>(messagesQueryKey),
      messageId,
    ) ?? findMessageInCachedMailboxQueries(queryClient, mailboxId, messageId);

  if (!messageToUpdate) {
    await rpc.mail.deleteDraft({ mailboxId, draftId }, { signal });
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(queryClient, mailboxId);
  const threadQueryKey = messageToUpdate.threadId
    ? getThreadQueryKey(mailboxId, messageToUpdate.threadId)
    : null;
  const previousThreadQuery = threadQueryKey
    ? snapshotThreadQuery(queryClient, threadQueryKey)
    : null;
  const optimisticTouchedQueryKeys = removeMessageFromCachedMailboxQueries(
    queryClient,
    mailboxId,
    messageId,
  );

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      removeMessageFromThreadData(currentData, messageId),
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey ? [...optimisticTouchedQueryKeys, threadQueryKey] : optimisticTouchedQueryKeys,
  );

  try {
    await rpc.mail.deleteDraft({ mailboxId, draftId }, { signal });
  } catch (error) {
    restoreMessagesQueries(queryClient, previousMessagesQueries);
    if (previousThreadQuery) {
      queryClient.setQueryData(previousThreadQuery.queryKey, previousThreadQuery.data);
    }
    await persistQueryKeys(
      queryClient,
      previousThreadQuery
        ? [
            ...previousMessagesQueries.map((snapshot) => snapshot.queryKey),
            previousThreadQuery.queryKey,
          ]
        : previousMessagesQueries.map((snapshot) => snapshot.queryKey),
    );
    throw error;
  }
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
    retry: shouldRetryGmailQuery,
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
    retry: shouldRetryGmailQuery,
    staleTime: 0,
    refetchOnMount: (query) =>
      (getRateLimitCooldownRemainingMs(query) ?? 0) > 0 ? false : "always",
    refetchOnWindowFocus: (query) =>
      (getRateLimitCooldownRemainingMs(query) ?? 0) > 0 ? false : "always",
    refetchOnReconnect: (query) =>
      (getRateLimitCooldownRemainingMs(query) ?? 0) > 0 ? false : "always",
    refetchInterval: (query) =>
      Math.max(
        GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS,
        getRateLimitCooldownRemainingMs(query) ?? 0,
      ),
    refetchIntervalInBackground: false,
  });
