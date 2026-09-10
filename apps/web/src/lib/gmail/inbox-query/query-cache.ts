import type { QueryClient } from "@tanstack/react-query";

import { isMessageInMailbox } from "#/lib/mail";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/mail";
import { persistQueryByKey } from "#/lib/query-persister";

import { getThreadLabelIds } from "../thread-list";
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
} from "./data";
import type { MessagesQueryData, ThreadMetadataMutationResult } from "./data";
import { getMessagesQueryKey, normalizeSearchQuery } from "./keys";

type CachedMessagesQuery = {
  queryKey: ReturnType<typeof getMessagesQueryKey>;
  data: MessagesQueryData | undefined;
  mailbox: MailboxCategory;
  searchQuery?: string;
};

const isMailboxCategory = (value: unknown): value is MailboxCategory =>
  value === "inbox" ||
  value === "unread" ||
  value === "archive" ||
  value === "spam" ||
  value === "sent" ||
  value === "trash" ||
  value === "drafts";

export const getCachedMessagesQueries = (
  queryClient: QueryClient,
  mailboxId: string
): CachedMessagesQuery[] =>
  queryClient
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
          data,
          mailbox,
          queryKey: getMessagesQueryKey(mailboxId, mailbox, rawSearchQuery),
          searchQuery: normalizeSearchQuery(rawSearchQuery),
        },
      ];
    });

export const persistQueryKeys = async (
  queryClient: QueryClient,
  queryKeys: readonly (readonly unknown[])[]
) => {
  const seenQueryKeys = new Set<string>();
  const uniqueQueryKeys: (readonly unknown[])[] = [];

  for (const queryKey of queryKeys) {
    const queryKeyId = JSON.stringify(queryKey);
    if (seenQueryKeys.has(queryKeyId)) {
      continue;
    }

    seenQueryKeys.add(queryKeyId);
    uniqueQueryKeys.push(queryKey);
  }

  await Promise.all(
    uniqueQueryKeys.map(async (queryKey) => {
      await persistQueryByKey(queryKey, queryClient);
    })
  );
};

export const applyOptimisticMailboxUpdate = async (
  queryClient: QueryClient,
  mailboxId: string,
  update: () => void,
  threadQueryKey?: ReturnType<typeof getThreadQueryKey>
) => {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ["messages", mailboxId] }),
    ...(threadQueryKey === undefined
      ? []
      : [queryClient.cancelQueries({ exact: true, queryKey: threadQueryKey })]),
  ]);
  const queryKeys: (readonly unknown[])[] = [
    ...getCachedMessagesQueries(queryClient, mailboxId).map(
      ({ queryKey }) => queryKey
    ),
    ...(threadQueryKey === undefined ? [] : [threadQueryKey]),
  ];
  const snapshots = queryKeys.map((queryKey) => ({
    data: queryClient.getQueryData(queryKey),
    queryKey,
  }));
  update();
  const changes = snapshots
    .map((snapshot) => ({
      ...snapshot,
      optimistic: queryClient.getQueryData(snapshot.queryKey),
    }))
    .filter(({ data, optimistic }) => data !== optimistic);
  await persistQueryKeys(
    queryClient,
    changes.map(({ queryKey }) => queryKey)
  );

  return async () => {
    await Promise.all(
      changes.map(async ({ queryKey, data, optimistic }) => {
        // A live update or another mutation owns newer data; reconcile it from the server.
        if (
          queryClient.getQueryData(queryKey) !== optimistic ||
          data === undefined
        ) {
          await queryClient.invalidateQueries({ exact: true, queryKey });
        } else {
          queryClient.setQueryData(queryKey, data);
        }
      })
    );
    await persistQueryKeys(
      queryClient,
      changes.map(({ queryKey }) => queryKey)
    );
  };
};

export const findMessageInCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  messageId: string
) => {
  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const message = findMessageInQueryData(cachedQuery.data, messageId);
    if (message) {
      return message;
    }
  }

  return undefined;
};

export const findMessagesInCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean
) => {
  const messagesById = new Map<string, MessageListItem>();

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    for (const page of cachedQuery.data?.pages ?? []) {
      for (const message of page.messages) {
        if (predicate(message)) {
          messagesById.set(message.id, message);
        }
      }
    }
  }

  return [...messagesById.values()];
};

const reconcileMessageInCachedMailboxQuery = (
  cachedQuery: CachedMessagesQuery,
  nextMessage: MessageListItem
): MessagesQueryData | undefined => {
  const currentMessage = findMessageInQueryData(
    cachedQuery.data,
    nextMessage.id
  );

  if (currentMessage) {
    if (!isMessageInMailbox(nextMessage, cachedQuery.mailbox)) {
      return removeMessagesFromQueryData(
        cachedQuery.data,
        (message) => message.id === nextMessage.id
      );
    }

    return updateMessageInQueryData(
      cachedQuery.data,
      nextMessage.id,
      (message) => mergeMessagePreservingLoadedDetails(message, nextMessage)
    );
  }

  if (
    (cachedQuery.searchQuery !== null &&
      cachedQuery.searchQuery !== undefined &&
      cachedQuery.searchQuery !== "") ||
    !isMessageInMailbox(nextMessage, cachedQuery.mailbox)
  ) {
    return cachedQuery.data;
  }

  return applySyncDeltaToQueryData(cachedQuery.data, [nextMessage], []);
};

export const applyMessageToCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  nextMessage: MessageListItem
) => {
  const touchedQueryKeys: ReturnType<typeof getMessagesQueryKey>[] = [];

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const nextData = reconcileMessageInCachedMailboxQuery(
      cachedQuery,
      nextMessage
    );
    if (nextData === cachedQuery.data) {
      continue;
    }

    queryClient.setQueryData(cachedQuery.queryKey, nextData);
    touchedQueryKeys.push(cachedQuery.queryKey);
  }

  return touchedQueryKeys;
};

export const updateMessagesInCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean,
  updater: (message: MessageListItem) => MessageListItem
) => {
  const touchedQueryKeys: ReturnType<typeof getMessagesQueryKey>[] = [];

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const nextData = updateMessagesInQueryData(
      cachedQuery.data,
      predicate,
      updater
    );
    if (nextData === cachedQuery.data) {
      continue;
    }

    queryClient.setQueryData(cachedQuery.queryKey, nextData);
    touchedQueryKeys.push(cachedQuery.queryKey);
  }

  return touchedQueryKeys;
};

export const removeMessagesFromCachedMailboxQueries = (
  queryClient: QueryClient,
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean
) => {
  const touchedQueryKeys: ReturnType<typeof getMessagesQueryKey>[] = [];

  for (const cachedQuery of getCachedMessagesQueries(queryClient, mailboxId)) {
    const nextData = removeMessagesFromQueryData(cachedQuery.data, predicate);
    if (nextData === cachedQuery.data) {
      continue;
    }

    queryClient.setQueryData(cachedQuery.queryKey, nextData);
    touchedQueryKeys.push(cachedQuery.queryKey);
  }

  return touchedQueryKeys;
};

export const applyResolvedThreadMetadataToCaches = async (
  queryClient: QueryClient,
  mailboxId: string,
  updatedThread: ThreadMetadataMutationResult
) => {
  const threadQueryKey = getThreadQueryKey(mailboxId, updatedThread.threadId);
  const updatesById = toMessageMetadataById(updatedThread.messages);
  const threadLabelIds = getThreadLabelIds(updatedThread.messages);
  const touchedQueryKeys: (readonly unknown[])[] = [];

  for (const updatedMessage of updatedThread.messages) {
    const previousMessage = findMessageInCachedMailboxQueries(
      queryClient,
      mailboxId,
      updatedMessage.id
    );
    if (!previousMessage) {
      continue;
    }

    touchedQueryKeys.push(
      ...applyMessageToCachedMailboxQueries(
        queryClient,
        mailboxId,
        applyMessageMetadata(previousMessage, {
          isUnread: updatedMessage.isUnread,
          labelIds: updatedMessage.labelIds,
          threadLabelIds,
        })
      )
    );
  }

  queryClient.setQueryData(
    threadQueryKey,
    (currentData: ThreadMessagesResult | undefined) =>
      updateMessagesInThreadData(
        currentData,
        (message) => updatesById.has(message.id),
        (message) => {
          const nextMessage = updatesById.get(message.id);
          return nextMessage
            ? applyMessageMetadata(message, {
                isUnread: nextMessage.isUnread,
                labelIds: nextMessage.labelIds,
                threadLabelIds,
              })
            : message;
        }
      )
  );

  await persistQueryKeys(queryClient, [...touchedQueryKeys, threadQueryKey]);
};
