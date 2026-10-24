import { getThreadLabelIds } from "@quieter/app/lib/gmail/thread-list";
import { isMessageInMailbox } from "@quieter/app/lib/mail";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
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
} from "@quieter/app/lib/mail/inbox-query/data";
import type {
  MessagesQueryData,
  ThreadMetadataMutationResult,
} from "@quieter/app/lib/mail/inbox-query/data";
import {
  getMessagesQueryKey,
  normalizeSearchQuery,
} from "@quieter/app/lib/mail/inbox-query/keys";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query";
import { getMailboxThreadQueriesKey } from "@quieter/app/lib/mail/thread-query-keys";
import { persistQueryByKey } from "@quieter/app/lib/query-persister";
import type { QueryClient } from "@tanstack/react-query";

type CachedMessagesQuery = {
  queryKey: ReturnType<typeof getMessagesQueryKey>;
  data: MessagesQueryData | undefined;
  mailbox: MailboxCategory;
  searchQuery?: string;
};

const isMailboxCategory = (value: unknown): value is MailboxCategory =>
  value === "inbox" ||
  value === "important" ||
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

export const applyResolvedThreadMetadataToCaches = (
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
          isImportant: updatedMessage.isImportant,
          isUnread: updatedMessage.isUnread,
          labelIds: updatedMessage.labelIds,
          threadIsImportant: updatedThread.isImportant,
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
                isImportant: nextMessage.isImportant,
                isUnread: nextMessage.isUnread,
                labelIds: nextMessage.labelIds,
                threadIsImportant: updatedThread.isImportant,
                threadLabelIds,
              })
            : message;
        }
      )
  );

  return [...touchedQueryKeys, threadQueryKey];
};

export const rememberRequestedUnsubscribe = async (
  queryClient: QueryClient,
  mailboxId: string,
  key: string,
  messageId: string
) => {
  const threadQueriesKey = getMailboxThreadQueriesKey(mailboxId);
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ["messages", mailboxId] }),
    queryClient.cancelQueries({ queryKey: threadQueriesKey }),
  ]);
  const matches = (message: MessageListItem) =>
    message.id === messageId || message.unsubscribeKey === key;
  const update = (message: MessageListItem): MessageListItem => ({
    ...message,
    unsubscribeKey: key,
    unsubscribeStatus: "requested",
  });
  const touched: (readonly unknown[])[] = updateMessagesInCachedMailboxQueries(
    queryClient,
    mailboxId,
    matches,
    update
  );
  for (const [
    queryKey,
    data,
  ] of queryClient.getQueriesData<ThreadMessagesResult>({
    queryKey: threadQueriesKey,
  })) {
    const next = updateMessagesInThreadData(data, matches, update);
    if (next !== data) {
      queryClient.setQueryData(queryKey, next);
      touched.push(queryKey);
    }
  }
  await persistQueryKeys(queryClient, touched);
  void queryClient.invalidateQueries({ queryKey: ["messages", mailboxId] });
  void queryClient.invalidateQueries({ queryKey: threadQueriesKey });
};
