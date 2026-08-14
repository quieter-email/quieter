import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

import { getGmailUnreadCountsQueryKey } from "../../mailboxes-query";
import { MAILBOX_LABELS } from "../gmail";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "../gmail";
import { getThreadQueryKey } from "../thread-query";
import {
  applyMessageLabelChangesLocally,
  applyMessageMetadata,
  applyThreadLabelChangesLocally,
  mergeMessagePreservingLoadedDetails,
  markMessageReadLocally,
  markMessageUnreadLocally,
  removeMessagesFromThreadData,
  updateMessageInThreadData,
  updateMessagesInThreadData,
} from "./data";
import type {
  LabelChangeSet,
  MessageMetadataMutationResult,
  MessagesQueryData,
  ThreadMetadataMutationResult,
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
} from "./query-cache";
import type { MessagesQuerySnapshot, ThreadQuerySnapshot } from "./query-cache";

type MessageActionArgs = {
  queryClient: QueryClient;
  mailboxId: string;
  mailbox: MailboxCategory;
  searchQuery: string | null | undefined;
  messageId: string;
  signal?: AbortSignal;
};

const mailboxMutationQueues = new Map<string, Promise<void>>();

const enqueueMailboxMutation = async <T>(
  mailboxId: string,
  operation: () => Promise<T>
) => {
  const previous = mailboxMutationQueues.get(mailboxId) ?? Promise.resolve();
  const current = (async () => {
    try {
      await previous;
    } catch {
      // Continue the mailbox queue after a failed mutation.
    }
    return await operation();
  })();
  const settled = (async () => {
    try {
      await current;
    } catch {
      // The operation's caller handles the failure.
    }
  })();
  mailboxMutationQueues.set(mailboxId, settled);

  try {
    return await current;
  } finally {
    if (mailboxMutationQueues.get(mailboxId) === settled) {
      mailboxMutationQueues.delete(mailboxId);
    }
  }
};

const getOptimisticCommandUpdater =
  (command: MailCommand) => (message: MessageListItem) => {
    if (command.kind === "set-read") {
      return command.read
        ? markMessageReadLocally(message)
        : markMessageUnreadLocally(message);
    }
    if (command.kind === "set-labels") {
      return applyMessageLabelChangesLocally(message, {
        addLabelIds: command.addIds,
        removeLabelIds: command.removeIds,
      });
    }
    if (command.kind === "delete-permanently") {
      return message;
    }
    if (command.destination === "archive") {
      return applyMessageLabelChangesLocally(message, ARCHIVE_LABEL_CHANGES);
    }
    if (command.destination === "spam") {
      return applyMessageLabelChangesLocally(
        message,
        MARK_AS_SPAM_LABEL_CHANGES
      );
    }
    if (command.destination === "trash") {
      return applyMessageLabelChangesLocally(
        message,
        MOVE_TO_TRASH_LABEL_CHANGES
      );
    }
    return applyMessageLabelChangesLocally(message, {
      addLabelIds: [MAILBOX_LABELS.inbox],
      removeLabelIds: [
        MAILBOX_LABELS.archive,
        MAILBOX_LABELS.spam,
        MAILBOX_LABELS.trash,
      ],
    });
  };

export const applyBulkChangesInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  targets: MailMutationTarget[],
  command: MailCommand
) =>
  await enqueueMailboxMutation(mailboxId, async () => {
    const snapshots = snapshotMessagesQueries(queryClient, mailboxId);
    const messageIds = new Set(targets.flatMap((target) => target.messageIds));
    const updater = getOptimisticCommandUpdater(command);
    const touchedQueryKeys = updateMessagesInCachedMailboxQueries(
      queryClient,
      mailboxId,
      (message) => messageIds.has(message.id),
      updater
    );
    await persistQueryKeys(queryClient, touchedQueryKeys);

    try {
      return await rpc.mail.applyChanges({ command, mailboxId, targets });
    } catch (error) {
      restoreMessagesQueries(queryClient, snapshots);
      await persistQueryKeys(
        queryClient,
        snapshots.map((snapshot) => snapshot.queryKey)
      );
      throw error;
    }
  });

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
  removeLabelIds: changes.removeLabelIds
    ? [...changes.removeLabelIds]
    : undefined,
});

const findMessageForAction = (args: MessageActionArgs) => {
  const messagesQueryKey = getMessagesQueryKey(
    args.mailboxId,
    args.mailbox,
    args.searchQuery
  );
  return (
    args.queryClient
      .getQueryData<MessagesQueryData>(messagesQueryKey)
      ?.pages.flatMap((page) => page.messages)
      .find((message) => message.id === args.messageId) ??
    findMessageInCachedMailboxQueries(
      args.queryClient,
      args.mailboxId,
      args.messageId
    )
  );
};

const restoreSnapshots = async (
  queryClient: QueryClient,
  messagesSnapshots: readonly MessagesQuerySnapshot[],
  threadSnapshot?: ThreadQuerySnapshot
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

const invalidateMailboxCounts = async (queryClient: QueryClient) => {
  await queryClient.invalidateQueries({
    queryKey: getGmailUnreadCountsQueryKey(),
  });
};

const applyMessageToCaches = (
  queryClient: QueryClient,
  mailboxId: string,
  threadQueryKey: ReturnType<typeof getThreadQueryKey> | undefined,
  nextMessage: MessageListItem
) => {
  const touchedQueryKeys: (readonly unknown[])[] = [
    ...applyMessageToCachedMailboxQueries(queryClient, mailboxId, nextMessage),
  ];

  if (threadQueryKey !== undefined) {
    queryClient.setQueryData(
      threadQueryKey,
      (currentData: ThreadMessagesResult | undefined) =>
        updateMessageInThreadData(currentData, nextMessage.id, (message) =>
          mergeMessagePreservingLoadedDetails(message, nextMessage)
        )
    );
    touchedQueryKeys.push(threadQueryKey);
  }

  return touchedQueryKeys;
};

const runOptimisticMessageMetadataMutation = async (
  args: MessageActionArgs & {
    mutation: (signal?: AbortSignal) => Promise<MessageMetadataMutationResult>;
    optimisticUpdater: (message: MessageListItem) => MessageListItem;
  }
) => {
  const messageToUpdate = findMessageForAction(args);
  if (!messageToUpdate) {
    await args.mutation(args.signal);
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(
    args.queryClient,
    args.mailboxId
  );
  const threadQueryKey = messageToUpdate.threadId
    ? getThreadQueryKey(args.mailboxId, messageToUpdate.threadId)
    : undefined;
  const previousThreadQuery =
    threadQueryKey === undefined
      ? undefined
      : snapshotThreadQuery(args.queryClient, threadQueryKey);
  const optimisticMessage = args.optimisticUpdater(messageToUpdate);

  await persistQueryKeys(
    args.queryClient,
    applyMessageToCaches(
      args.queryClient,
      args.mailboxId,
      threadQueryKey,
      optimisticMessage
    )
  );

  try {
    const updatedMessage = await args.mutation(args.signal);
    const resolvedMessage = applyMessageMetadata(optimisticMessage, {
      isUnread: updatedMessage.isUnread,
      labelIds: updatedMessage.labelIds,
    });

    await persistQueryKeys(
      args.queryClient,
      applyMessageToCaches(
        args.queryClient,
        args.mailboxId,
        threadQueryKey,
        resolvedMessage
      )
    );
    await invalidateMailboxCounts(args.queryClient);
  } catch (error) {
    await restoreSnapshots(
      args.queryClient,
      previousMessagesQueries,
      previousThreadQuery
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
  const previousMessagesQueries = snapshotMessagesQueries(
    args.queryClient,
    args.mailboxId
  );
  const previousThreadQuery = snapshotThreadQuery(
    args.queryClient,
    threadQueryKey
  );

  const optimisticTouchedQueryKeys = updateMessagesInCachedMailboxQueries(
    args.queryClient,
    args.mailboxId,
    (message) => message.threadId === args.threadId,
    args.optimisticUpdater
  );
  args.queryClient.setQueryData(
    threadQueryKey,
    (currentData: ThreadMessagesResult | undefined) =>
      updateMessagesInThreadData(
        currentData,
        () => true,
        args.optimisticUpdater
      )
  );

  await persistQueryKeys(args.queryClient, [
    ...optimisticTouchedQueryKeys,
    threadQueryKey,
  ]);

  try {
    const updatedThread = await args.mutation(args.signal);
    await applyResolvedThreadMetadataToCaches(
      args.queryClient,
      args.mailboxId,
      updatedThread
    );
    await invalidateMailboxCounts(args.queryClient);
  } catch (error) {
    await restoreSnapshots(
      args.queryClient,
      previousMessagesQueries,
      previousThreadQuery
    );
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
  const previousMessagesQueries = snapshotMessagesQueries(
    args.queryClient,
    args.mailboxId
  );
  const previousThreadQuery = snapshotThreadQuery(
    args.queryClient,
    threadQueryKey
  );
  const optimisticMessages = findMessagesInCachedMailboxQueries(
    args.queryClient,
    args.mailboxId,
    (message) => message.threadId === args.threadId
  ).map((message) => applyThreadLabelChangesLocally(message, args.changes));
  const optimisticTouchedQueryKeys = optimisticMessages.flatMap((message) =>
    applyMessageToCachedMailboxQueries(
      args.queryClient,
      args.mailboxId,
      message
    )
  );

  args.queryClient.setQueryData(
    threadQueryKey,
    (currentData: ThreadMessagesResult | undefined) =>
      updateMessagesInThreadData(
        currentData,
        () => true,
        (message) => applyThreadLabelChangesLocally(message, args.changes)
      )
  );
  await persistQueryKeys(args.queryClient, [
    ...optimisticTouchedQueryKeys,
    threadQueryKey,
  ]);

  try {
    const updatedThread = await args.mutation(args.signal);
    await applyResolvedThreadMetadataToCaches(
      args.queryClient,
      args.mailboxId,
      updatedThread
    );
    await invalidateMailboxCounts(args.queryClient);
  } catch (error) {
    await restoreSnapshots(
      args.queryClient,
      previousMessagesQueries,
      previousThreadQuery
    );
    throw error;
  }
};

const runOptimisticMessageRemoval = async (
  args: MessageActionArgs & {
    mutation: (signal?: AbortSignal) => Promise<void>;
  }
) => {
  const messageToRemove = findMessageForAction(args);
  if (!messageToRemove) {
    await args.mutation(args.signal);
    return;
  }

  const previousMessagesQueries = snapshotMessagesQueries(
    args.queryClient,
    args.mailboxId
  );
  const threadQueryKey = messageToRemove.threadId
    ? getThreadQueryKey(args.mailboxId, messageToRemove.threadId)
    : undefined;
  const previousThreadQuery =
    threadQueryKey === undefined
      ? undefined
      : snapshotThreadQuery(args.queryClient, threadQueryKey);
  const touchedQueryKeys = removeMessagesFromCachedMailboxQueries(
    args.queryClient,
    args.mailboxId,
    (message) => message.id === args.messageId
  );

  if (threadQueryKey !== undefined) {
    args.queryClient.setQueryData(
      threadQueryKey,
      (currentData: ThreadMessagesResult | undefined) =>
        removeMessagesFromThreadData(
          currentData,
          (message) => message.id === args.messageId
        )
    );
  }

  await persistQueryKeys(
    args.queryClient,
    threadQueryKey === undefined
      ? touchedQueryKeys
      : [...touchedQueryKeys, threadQueryKey]
  );

  try {
    await args.mutation(args.signal);
    await invalidateMailboxCounts(args.queryClient);
  } catch (error) {
    await restoreSnapshots(
      args.queryClient,
      previousMessagesQueries,
      previousThreadQuery
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
  signal?: AbortSignal
) => {
  await runOptimisticMessageMetadataMutation({
    mailbox,
    mailboxId,
    messageId,
    mutation: async (mutationSignal) =>
      await rpc.mail.markMessageAsRead(
        { mailboxId, messageId },
        { signal: mutationSignal }
      ),
    optimisticUpdater: markMessageReadLocally,
    queryClient,
    searchQuery,
    signal,
  });
};

export const markMessageAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal
) => {
  await runOptimisticMessageMetadataMutation({
    mailbox,
    mailboxId,
    messageId,
    mutation: async (mutationSignal) =>
      await rpc.mail.markMessageAsUnread(
        { mailboxId, messageId },
        { signal: mutationSignal }
      ),
    optimisticUpdater: markMessageUnreadLocally,
    queryClient,
    searchQuery,
    signal,
  });
};

export const markThreadAsReadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal
) => {
  await runOptimisticThreadMetadataMutation({
    mailboxId,
    mutation: async (mutationSignal) =>
      await rpc.mail.markThreadAsRead(
        { mailboxId, threadId },
        { signal: mutationSignal }
      ),
    optimisticUpdater: markMessageReadLocally,
    queryClient,
    signal,
    threadId,
  });
};

export const markThreadAsUnreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal
) => {
  await runOptimisticThreadMetadataMutation({
    mailboxId,
    mutation: async (mutationSignal) =>
      await rpc.mail.markThreadAsUnread(
        { mailboxId, threadId },
        { signal: mutationSignal }
      ),
    optimisticUpdater: markMessageUnreadLocally,
    queryClient,
    signal,
    threadId,
  });
};

export const archiveMessageInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal
) => {
  await updateMessageLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    ARCHIVE_LABEL_CHANGES,
    signal
  );
};

export const archiveThreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal
) => {
  await updateThreadLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    threadId,
    ARCHIVE_LABEL_CHANGES,
    signal
  );
};

export const updateMessageLabelsInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  changes: LabelChangeSet,
  signal?: AbortSignal
) => {
  await runOptimisticMessageMetadataMutation({
    mailbox,
    mailboxId,
    messageId,
    mutation: async (mutationSignal) =>
      await rpc.mail.updateMessageLabels(
        {
          mailboxId,
          messageId,
          ...toRpcLabelChanges(changes),
        },
        { signal: mutationSignal }
      ),
    optimisticUpdater: (message) =>
      applyMessageLabelChangesLocally(message, changes),
    queryClient,
    searchQuery,
    signal,
  });
};

export const updateThreadLabelsInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  changes: LabelChangeSet,
  signal?: AbortSignal
) => {
  await runOptimisticThreadLabelMutation({
    changes,
    mailboxId,
    mutation: async (mutationSignal) =>
      await rpc.mail.updateThreadLabels(
        {
          mailboxId,
          threadId,
          ...toRpcLabelChanges(changes),
        },
        { signal: mutationSignal }
      ),
    queryClient,
    signal,
    threadId,
  });
};

export const markMessageAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal
) => {
  await updateMessageLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    MARK_AS_SPAM_LABEL_CHANGES,
    signal
  );
};

export const markThreadAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal
) => {
  await updateThreadLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    threadId,
    MARK_AS_SPAM_LABEL_CHANGES,
    signal
  );
};

export const unmarkMessageAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal
) => {
  await updateMessageLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    UNMARK_AS_SPAM_LABEL_CHANGES,
    signal
  );
};

export const unmarkThreadAsSpamInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal
) => {
  await updateThreadLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    threadId,
    UNMARK_AS_SPAM_LABEL_CHANGES,
    signal
  );
};

export const moveMessageToTrashInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal
) => {
  await runOptimisticMessageMetadataMutation({
    mailbox,
    mailboxId,
    messageId,
    mutation: async (mutationSignal) =>
      await rpc.mail.moveMessageToTrash(
        { mailboxId, messageId },
        { signal: mutationSignal }
      ),
    optimisticUpdater: (message) =>
      applyMessageLabelChangesLocally(message, MOVE_TO_TRASH_LABEL_CHANGES),
    queryClient,
    searchQuery,
    signal,
  });
};

export const untrashMessageInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  signal?: AbortSignal
) => {
  await updateMessageLabelsInMailbox(
    queryClient,
    mailboxId,
    mailbox,
    searchQuery,
    messageId,
    REMOVE_FROM_TRASH_LABEL_CHANGES,
    signal
  );
};

export const moveThreadToTrashInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal
) => {
  await runOptimisticThreadLabelMutation({
    changes: MOVE_TO_TRASH_LABEL_CHANGES,
    mailboxId,
    mutation: async (mutationSignal) =>
      await rpc.mail.moveThreadToTrash(
        { mailboxId, threadId },
        { signal: mutationSignal }
      ),
    queryClient,
    signal,
    threadId,
  });
};

export const untrashThreadInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  _mailbox: MailboxCategory,
  _searchQuery: string | null | undefined,
  threadId: string,
  signal?: AbortSignal
) => {
  await runOptimisticThreadLabelMutation({
    changes: REMOVE_FROM_TRASH_LABEL_CHANGES,
    mailboxId,
    mutation: async (mutationSignal) =>
      await rpc.mail.untrashThread(
        { mailboxId, threadId },
        { signal: mutationSignal }
      ),
    queryClient,
    signal,
    threadId,
  });
};

export const deleteDraftInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  draftId: string,
  signal?: AbortSignal
) => {
  await runOptimisticMessageRemoval({
    mailbox,
    mailboxId,
    messageId,
    mutation: async (mutationSignal) => {
      await rpc.mail.deleteDraft(
        { draftId, mailboxId },
        { signal: mutationSignal }
      );
    },
    queryClient,
    searchQuery,
    signal,
  });
};

export const removeDraftMessageFromCaches = async (
  queryClient: QueryClient,
  mailboxId: string,
  messageId: string,
  threadId?: string | null
) => {
  const touchedQueryKeys = removeMessagesFromCachedMailboxQueries(
    queryClient,
    mailboxId,
    (message) => message.id === messageId
  );
  const threadQueryKey =
    threadId !== null && threadId !== undefined && threadId !== ""
      ? getThreadQueryKey(mailboxId, threadId)
      : undefined;

  if (threadQueryKey !== undefined) {
    queryClient.setQueryData(
      threadQueryKey,
      (currentData: ThreadMessagesResult | undefined) =>
        removeMessagesFromThreadData(
          currentData,
          (message) => message.id === messageId
        )
    );
  }

  await persistQueryKeys(
    queryClient,
    threadQueryKey === undefined
      ? touchedQueryKeys
      : [...touchedQueryKeys, threadQueryKey]
  );
};
