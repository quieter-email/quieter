import type { QueryClient } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import {
  MAILBOX_LABELS,
  type MailboxCategory,
  type MessageListItem,
  type ThreadMessagesResult,
} from "../gmail";
import { getThreadQueryKey } from "../thread-query";
import {
  applyMessageLabelChangesLocally,
  applyMessageMetadata,
  mergeMessagePreservingLoadedDetails,
  markMessageReadLocally,
  markMessageUnreadLocally,
  removeMessagesFromThreadData,
  toMessageMetadataById,
  updateMessageInThreadData,
  updateMessagesInThreadData,
  type LabelChangeSet,
  type MessageMetadataMutationResult,
  type MessagesQueryData,
  type ThreadMetadataMutationResult,
} from "./data";
import { getMessagesQueryKey } from "./keys";
import {
  applyMessageToCachedMailboxQueries,
  applyResolvedThreadMetadataToCaches,
  findMessageInCachedMailboxQueries,
  findMessagesInCachedMailboxQueries,
  persistQueryKeys,
  removeMessagesFromCachedMailboxQueries,
  restoreMessagesQueries,
  snapshotMessagesQueries,
  snapshotThreadQuery,
  updateMessagesInCachedMailboxQueries,
  type MessagesQuerySnapshot,
  type ThreadQuerySnapshot,
} from "./query-cache";

type MessageActionArgs = {
  queryClient: QueryClient;
  mailboxId: string;
  mailbox: MailboxCategory;
  searchQuery: string | null | undefined;
  messageId: string;
  signal?: AbortSignal;
};

const MARK_AS_SPAM_LABEL_CHANGES = {
  addLabelIds: [MAILBOX_LABELS.spam],
  removeLabelIds: [MAILBOX_LABELS.inbox],
} as const;

const ARCHIVE_LABEL_CHANGES = {
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

const toRpcLabelChanges = (changes: LabelChangeSet) => ({
  addLabelIds: changes.addLabelIds ? [...changes.addLabelIds] : undefined,
  removeLabelIds: changes.removeLabelIds ? [...changes.removeLabelIds] : undefined,
});

const findMessageForAction = (args: MessageActionArgs) => {
  const messagesQueryKey = getMessagesQueryKey(args.mailboxId, args.mailbox, args.searchQuery);
  return (
    args.queryClient
      .getQueryData<MessagesQueryData>(messagesQueryKey)
      ?.pages.flatMap((page) => page.messages)
      .find((message) => message.id === args.messageId) ??
    findMessageInCachedMailboxQueries(args.queryClient, args.mailboxId, args.messageId)
  );
};

const restoreSnapshots = async (
  queryClient: QueryClient,
  messagesSnapshots: readonly MessagesQuerySnapshot[],
  threadSnapshot?: ThreadQuerySnapshot,
) => {
  restoreMessagesQueries(queryClient, messagesSnapshots);
  if (threadSnapshot) {
    queryClient.setQueryData(threadSnapshot.queryKey, threadSnapshot.data);
  }

  await persistQueryKeys(queryClient, [
    ...messagesSnapshots.map((snapshot) => snapshot.queryKey),
    ...(threadSnapshot ? [threadSnapshot.queryKey] : []),
  ]);
};

const applyMessageToCaches = (
  queryClient: QueryClient,
  mailboxId: string,
  threadQueryKey: ReturnType<typeof getThreadQueryKey> | undefined,
  nextMessage: MessageListItem,
) => {
  const touchedQueryKeys: Array<readonly unknown[]> = [
    ...applyMessageToCachedMailboxQueries(queryClient, mailboxId, nextMessage),
  ];

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, nextMessage.id, (message) =>
        mergeMessagePreservingLoadedDetails(message, nextMessage),
      ),
    );
    touchedQueryKeys.push(threadQueryKey);
  }

  return touchedQueryKeys;
};

const runOptimisticMessageMetadataMutation = async (
  args: MessageActionArgs & {
    mutation: (signal?: AbortSignal) => Promise<MessageMetadataMutationResult>;
    optimisticUpdater: (message: MessageListItem) => MessageListItem;
  },
) => {
  const messageToUpdate = findMessageForAction(args);
  if (!messageToUpdate) {
    await args.mutation(args.signal);
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(args.queryClient, args.mailboxId);
  const threadQueryKey = messageToUpdate.threadId
    ? getThreadQueryKey(args.mailboxId, messageToUpdate.threadId)
    : undefined;
  const previousThreadQuery =
    threadQueryKey && snapshotThreadQuery(args.queryClient, threadQueryKey);
  const optimisticMessage = args.optimisticUpdater(messageToUpdate);

  await persistQueryKeys(
    args.queryClient,
    applyMessageToCaches(args.queryClient, args.mailboxId, threadQueryKey, optimisticMessage),
  );

  try {
    const updatedMessage = await args.mutation(args.signal);
    const resolvedMessage = applyMessageMetadata(optimisticMessage, {
      labelIds: updatedMessage.labelIds,
      isUnread: updatedMessage.isUnread,
    });

    await persistQueryKeys(
      args.queryClient,
      applyMessageToCaches(args.queryClient, args.mailboxId, threadQueryKey, resolvedMessage),
    );
  } catch (error) {
    await restoreSnapshots(
      args.queryClient,
      previousMessagesQueries,
      previousThreadQuery || undefined,
    );
    throw error;
  }
};

const runOptimisticThreadMetadataMutation = async (args: {
  queryClient: QueryClient;
  mailboxId: string;
  threadId: string;
  signal?: AbortSignal;
  mutation: (signal?: AbortSignal) => Promise<ThreadMetadataMutationResult>;
  optimisticUpdater: (message: MessageListItem) => MessageListItem;
}) => {
  const threadQueryKey = getThreadQueryKey(args.mailboxId, args.threadId);
  const previousMessagesQueries = snapshotMessagesQueries(args.queryClient, args.mailboxId);
  const previousThreadQuery = snapshotThreadQuery(args.queryClient, threadQueryKey);

  const optimisticTouchedQueryKeys = updateMessagesInCachedMailboxQueries(
    args.queryClient,
    args.mailboxId,
    (message) => message.threadId === args.threadId,
    args.optimisticUpdater,
  );
  args.queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
    updateMessagesInThreadData(currentData, () => true, args.optimisticUpdater),
  );

  await persistQueryKeys(args.queryClient, [...optimisticTouchedQueryKeys, threadQueryKey]);

  try {
    const updatedThread = await args.mutation(args.signal);
    const updatesById = toMessageMetadataById(updatedThread.messages);
    const resolvedTouchedQueryKeys = updateMessagesInCachedMailboxQueries(
      args.queryClient,
      args.mailboxId,
      (message) => updatesById.has(message.id),
      (message) => {
        const updatedMessage = updatesById.get(message.id);
        return updatedMessage
          ? applyMessageMetadata(message, {
              labelIds: updatedMessage.labelIds,
              isUnread: updatedMessage.isUnread,
            })
          : message;
      },
    );

    args.queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      updateMessagesInThreadData(
        currentData,
        (message) => updatesById.has(message.id),
        (message) => {
          const updatedMessage = updatesById.get(message.id);
          return updatedMessage
            ? applyMessageMetadata(message, {
                labelIds: updatedMessage.labelIds,
                isUnread: updatedMessage.isUnread,
              })
            : message;
        },
      ),
    );

    await persistQueryKeys(args.queryClient, [...resolvedTouchedQueryKeys, threadQueryKey]);
  } catch (error) {
    await restoreSnapshots(args.queryClient, previousMessagesQueries, previousThreadQuery);
    throw error;
  }
};

const runOptimisticThreadLabelMutation = async (args: {
  queryClient: QueryClient;
  mailboxId: string;
  threadId: string;
  changes: LabelChangeSet;
  signal?: AbortSignal;
  mutation: (signal?: AbortSignal) => Promise<ThreadMetadataMutationResult>;
}) => {
  const threadQueryKey = getThreadQueryKey(args.mailboxId, args.threadId);
  const previousMessagesQueries = snapshotMessagesQueries(args.queryClient, args.mailboxId);
  const previousThreadQuery = snapshotThreadQuery(args.queryClient, threadQueryKey);
  const optimisticMessages = findMessagesInCachedMailboxQueries(
    args.queryClient,
    args.mailboxId,
    (message) => message.threadId === args.threadId,
  ).map((message) => applyMessageLabelChangesLocally(message, args.changes));
  const optimisticTouchedQueryKeys = optimisticMessages.flatMap((message) =>
    applyMessageToCachedMailboxQueries(args.queryClient, args.mailboxId, message),
  );

  args.queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
    updateMessagesInThreadData(
      currentData,
      () => true,
      (message) => applyMessageLabelChangesLocally(message, args.changes),
    ),
  );
  await persistQueryKeys(args.queryClient, [...optimisticTouchedQueryKeys, threadQueryKey]);

  try {
    const updatedThread = await args.mutation(args.signal);
    await applyResolvedThreadMetadataToCaches(args.queryClient, args.mailboxId, updatedThread);
  } catch (error) {
    await restoreSnapshots(args.queryClient, previousMessagesQueries, previousThreadQuery);
    throw error;
  }
};

const runOptimisticMessageRemoval = async (
  args: MessageActionArgs & {
    mutation: (signal?: AbortSignal) => Promise<void>;
  },
) => {
  const messageToRemove = findMessageForAction(args);
  if (!messageToRemove) {
    await args.mutation(args.signal);
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(args.queryClient, args.mailboxId);
  const threadQueryKey = messageToRemove.threadId
    ? getThreadQueryKey(args.mailboxId, messageToRemove.threadId)
    : undefined;
  const previousThreadQuery =
    threadQueryKey && snapshotThreadQuery(args.queryClient, threadQueryKey);
  const touchedQueryKeys = removeMessagesFromCachedMailboxQueries(
    args.queryClient,
    args.mailboxId,
    (message) => message.id === args.messageId,
  );

  if (threadQueryKey) {
    args.queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      removeMessagesFromThreadData(currentData, (message) => message.id === args.messageId),
    );
  }

  await persistQueryKeys(
    args.queryClient,
    threadQueryKey ? [...touchedQueryKeys, threadQueryKey] : touchedQueryKeys,
  );

  try {
    await args.mutation(args.signal);
  } catch (error) {
    await restoreSnapshots(
      args.queryClient,
      previousMessagesQueries,
      previousThreadQuery || undefined,
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
  await runOptimisticMessageMetadataMutation({
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.markMessageAsRead({ mailboxId, messageId }, { signal: mutationSignal }),
    optimisticUpdater: markMessageReadLocally,
  });
};

export const markMessageAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal,
) => {
  await runOptimisticMessageMetadataMutation({
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.markMessageAsUnread({ mailboxId, messageId }, { signal: mutationSignal }),
    optimisticUpdater: markMessageUnreadLocally,
  });
};

export const markThreadAsReadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await runOptimisticThreadMetadataMutation({
    queryClient,
    mailboxId,
    threadId,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.markThreadAsRead({ mailboxId, threadId }, { signal: mutationSignal }),
    optimisticUpdater: markMessageReadLocally,
  });
};

export const markThreadAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await runOptimisticThreadMetadataMutation({
    queryClient,
    mailboxId,
    threadId,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.markThreadAsUnread({ mailboxId, threadId }, { signal: mutationSignal }),
    optimisticUpdater: markMessageUnreadLocally,
  });
};

export const archiveMessageInMailbox = async (
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
    ARCHIVE_LABEL_CHANGES,
    signal,
  );
};

export const archiveThreadInMailbox = async (
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
    ARCHIVE_LABEL_CHANGES,
    signal,
  );
};

export const updateMessageLabelsInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  changes: LabelChangeSet,
  signal?: AbortSignal,
) => {
  await runOptimisticMessageMetadataMutation({
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.updateMessageLabels(
        {
          mailboxId,
          messageId,
          ...toRpcLabelChanges(changes),
        },
        { signal: mutationSignal },
      ),
    optimisticUpdater: (message) => applyMessageLabelChangesLocally(message, changes),
  });
};

export const updateThreadLabelsInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  changes: LabelChangeSet,
  signal?: AbortSignal,
) => {
  await runOptimisticThreadLabelMutation({
    queryClient,
    mailboxId,
    threadId,
    changes,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.updateThreadLabels(
        {
          mailboxId,
          threadId,
          ...toRpcLabelChanges(changes),
        },
        { signal: mutationSignal },
      ),
  });
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
    MARK_AS_SPAM_LABEL_CHANGES,
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
    MARK_AS_SPAM_LABEL_CHANGES,
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
    UNMARK_AS_SPAM_LABEL_CHANGES,
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
    UNMARK_AS_SPAM_LABEL_CHANGES,
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
  await runOptimisticMessageMetadataMutation({
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.moveMessageToTrash({ mailboxId, messageId }, { signal: mutationSignal }),
    optimisticUpdater: (message) =>
      applyMessageLabelChangesLocally(message, MOVE_TO_TRASH_LABEL_CHANGES),
  });
};

export const untrashMessageInMailbox = async (
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
    REMOVE_FROM_TRASH_LABEL_CHANGES,
    signal,
  );
};

export const moveThreadToTrashInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await runOptimisticThreadLabelMutation({
    queryClient,
    mailboxId,
    threadId,
    changes: MOVE_TO_TRASH_LABEL_CHANGES,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.moveThreadToTrash({ mailboxId, threadId }, { signal: mutationSignal }),
  });
};

export const untrashThreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal,
) => {
  await runOptimisticThreadLabelMutation({
    queryClient,
    mailboxId,
    threadId,
    changes: REMOVE_FROM_TRASH_LABEL_CHANGES,
    signal,
    mutation: async (mutationSignal) =>
      await rpc.mail.untrashThread({ mailboxId, threadId }, { signal: mutationSignal }),
  });
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
  await runOptimisticMessageRemoval({
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    signal,
    mutation: async (mutationSignal) => {
      await rpc.mail.deleteDraft({ mailboxId, draftId }, { signal: mutationSignal });
    },
  });
};

export const removeDraftMessageFromCaches = async (
  queryClient: QueryClient,
  mailboxId: string,
  messageId: string,
  threadId?: string | null,
) => {
  const touchedQueryKeys = removeMessagesFromCachedMailboxQueries(
    queryClient,
    mailboxId,
    (message) => message.id === messageId,
  );
  const threadQueryKey = threadId && getThreadQueryKey(mailboxId, threadId);

  if (threadQueryKey) {
    queryClient.setQueryData(threadQueryKey, (currentData: ThreadMessagesResult | undefined) =>
      removeMessagesFromThreadData(currentData, (message) => message.id === messageId),
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey ? [...touchedQueryKeys, threadQueryKey] : touchedQueryKeys,
  );
};
