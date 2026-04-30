import type { QueryClient } from "@tanstack/react-query";
import { queryPersister } from "~/lib/query-persister";
import {
  isMessageInMailbox,
  type MailboxCategory,
  type MessageListItem,
  type ThreadMessagesResult,
} from "../gmail";
import { getThreadQueryKey } from "../thread-query";
import {
  applyMessageMetadata,
  applySyncDeltaToQueryData,
  findMessageInQueryData,
  isMessagesQueryData,
  mergeMessagePreservingLoadedDetails,
  removeMessagesFromQueryData,
  toMessageMetadataById,
  updateMessageInQueryData,
  updateMessagesInQueryData,
  updateMessagesInThreadData,
  type MessagesQueryData,
  type ThreadMetadataMutationResult,
} from "./data";
import { getMessagesQueryKey, normalizeSearchQuery } from "./keys";

export type MessagesQuerySnapshot = {
  queryKey: ReturnType<typeof getMessagesQueryKey>;
  data: MessagesQueryData | undefined;
};

export type ThreadQuerySnapshot = {
  queryKey: ReturnType<typeof getThreadQueryKey>;
  data: ThreadMessagesResult | undefined;
};

type CachedMessagesQuery = MessagesQuerySnapshot & {
  mailbox: MailboxCategory;
  searchQuery?: string;
};

const isMailboxCategory = (value: unknown): value is MailboxCategory =>
  value === "inbox" ||
  value === "spam" ||
  value === "sent" ||
  value === "trash" ||
  value === "drafts";

export const getCachedMessagesQueries = (
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

export const snapshotMessagesQueries = (
  queryClient: QueryClient,
  mailboxId: string,
): MessagesQuerySnapshot[] => {
  return getCachedMessagesQueries(queryClient, mailboxId).map((cachedQuery) => ({
    queryKey: cachedQuery.queryKey,
    data: cachedQuery.data,
  }));
};

export const snapshotThreadQuery = (
  queryClient: QueryClient,
  threadQueryKey: ReturnType<typeof getThreadQueryKey>,
): ThreadQuerySnapshot => ({
  queryKey: threadQueryKey,
  data: queryClient.getQueryData<ThreadMessagesResult>(threadQueryKey),
});

export const restoreMessagesQueries = (
  queryClient: QueryClient,
  snapshots: readonly MessagesQuerySnapshot[],
) => {
  for (const snapshot of snapshots) {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data);
  }
};

export const persistQueryKeys = async (
  queryClient: QueryClient,
  queryKeys: ReadonlyArray<readonly unknown[]>,
) => {
  const seenQueryKeys = new Set<string>();

  for (const queryKey of queryKeys) {
    const queryKeyId = JSON.stringify(queryKey);
    if (seenQueryKeys.has(queryKeyId)) continue;

    seenQueryKeys.add(queryKeyId);
    await queryPersister.persistQueryByKey(queryKey, queryClient);
  }
};

export const findMessageInCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  messageId: string,
) => {
  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const message = findMessageInQueryData(cachedQuery.data, messageId);
    if (message) return message;
  }

  return undefined;
};

export const findMessagesInCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean,
) => {
  const messagesById = new Map<string, MessageListItem>();

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    for (const page of cachedQuery.data?.pages ?? []) {
      for (const message of page.messages) {
        if (predicate(message)) messagesById.set(message.id, message);
      }
    }
  }

  return Array.from(messagesById.values());
};

const reconcileMessageInCachedMailboxQuery = (
  cachedQuery: CachedMessagesQuery,
  nextMessage: MessageListItem,
): MessagesQueryData | undefined => {
  const currentMessage = findMessageInQueryData(cachedQuery.data, nextMessage.id);

  if (currentMessage) {
    if (!isMessageInMailbox(nextMessage, cachedQuery.mailbox)) {
      return removeMessagesFromQueryData(
        cachedQuery.data,
        (message) => message.id === nextMessage.id,
      );
    }

    return updateMessageInQueryData(cachedQuery.data, nextMessage.id, (message) =>
      mergeMessagePreservingLoadedDetails(message, nextMessage),
    );
  }

  if (cachedQuery.searchQuery || !isMessageInMailbox(nextMessage, cachedQuery.mailbox)) {
    return cachedQuery.data;
  }

  return applySyncDeltaToQueryData(cachedQuery.data, [nextMessage], []);
};

export const applyMessageToCachedMailboxQueries = (
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

export const updateMessagesInCachedMailboxQueries = (
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

export const removeMessagesFromCachedMailboxQueries = (
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

export const applyResolvedThreadMetadataToCaches = async (
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

    touchedQueryKeys.push(
      ...applyMessageToCachedMailboxQueries(
        queryClient,
        mailboxId,
        applyMessageMetadata(previousMessage, {
          labelIds: updatedMessage.labelIds,
          isUnread: updatedMessage.isUnread,
        }),
      ),
    );
  }

  queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
    updateMessagesInThreadData(
      currentData,
      (message) => updatesById.has(message.id),
      (message) => {
        const nextMessage = updatesById.get(message.id);
        return nextMessage
          ? applyMessageMetadata(message, {
              labelIds: nextMessage.labelIds,
              isUnread: nextMessage.isUnread,
            })
          : message;
      },
    ),
  );

  await persistQueryKeys(queryClient, [...touchedQueryKeys, threadQueryKey]);
};
