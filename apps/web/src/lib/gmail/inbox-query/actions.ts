import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";

import { MAILBOX_LABELS } from "#/lib/mail";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/mail";
import { MailSyncSession } from "#/lib/mail-sync/session";
import { rpc } from "#/lib/orpc";

import { getGmailUnreadCountsQueryKey } from "../../mailboxes-query";
import { getThreadQueryKey } from "../thread-query";
import {
  applyMessageLabelChangesLocally,
  applyMessageMetadata,
  markMessageReadLocally,
  markMessageUnreadLocally,
  getMailCommandUpdater,
  applyThreadLabelChangesLocally,
  mergeMessagePreservingLoadedDetails,
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
  applyOptimisticMailboxUpdate,
  applyResolvedThreadMetadataToCaches,
  findMessageInCachedMailboxQueries,
  findMessagesInCachedMailboxQueries,
  persistQueryKeys,
  removeMessagesFromCachedMailboxQueries,
  updateMessagesInCachedMailboxQueries,
} from "./query-cache";

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

export const applyBulkChangesInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  targets: MailMutationTarget[],
  command: MailCommand
) =>
  await enqueueMailboxMutation(mailboxId, async () => {
    const sync = MailSyncSession.forMailbox(mailboxId);
    if (sync !== null) {
      return await sync.command(mailboxId, targets, command);
    }
    const messageIds = new Set(targets.flatMap((target) => target.messageIds));
    const updater = getMailCommandUpdater(command);
    const rollback = await applyOptimisticMailboxUpdate(
      queryClient,
      mailboxId,
      () => {
        updateMessagesInCachedMailboxQueries(
          queryClient,
          mailboxId,
          (message) => messageIds.has(message.id),
          updater
        );
      }
    );

    try {
      return await rpc.mail.applyChanges({ command, mailboxId, targets });
    } catch (error) {
      await rollback();
      throw error;
    }
  });

const METADATA_LABEL_CHANGES = {
  archive: { removeLabelIds: [MAILBOX_LABELS.inbox] },
  read: { removeLabelIds: [MAILBOX_LABELS.unread] },
  spam: {
    addLabelIds: [MAILBOX_LABELS.spam],
    removeLabelIds: [MAILBOX_LABELS.inbox],
  },
  trash: {
    addLabelIds: [MAILBOX_LABELS.trash],
    removeLabelIds: [
      MAILBOX_LABELS.inbox,
      MAILBOX_LABELS.spam,
      MAILBOX_LABELS.sent,
      MAILBOX_LABELS.drafts,
    ],
  },
  unread: { addLabelIds: [MAILBOX_LABELS.unread] },
  unspam: {
    addLabelIds: [MAILBOX_LABELS.inbox],
    removeLabelIds: [MAILBOX_LABELS.spam],
  },
  untrash: {
    addLabelIds: [MAILBOX_LABELS.inbox],
    removeLabelIds: [MAILBOX_LABELS.trash],
  },
} satisfies Record<string, LabelChangeSet>;

export type MailMetadataOperation =
  | keyof typeof METADATA_LABEL_CHANGES
  | LabelChangeSet;

const MESSAGE_METADATA_MUTATIONS = {
  archive: rpc.mail.updateMessageLabels,
  read: rpc.mail.markMessageAsRead,
  spam: rpc.mail.updateMessageLabels,
  trash: rpc.mail.moveMessageToTrash,
  unread: rpc.mail.markMessageAsUnread,
  unspam: rpc.mail.updateMessageLabels,
  untrash: rpc.mail.untrashMessage,
};
const THREAD_METADATA_MUTATIONS = {
  archive: rpc.mail.updateThreadLabels,
  read: rpc.mail.markThreadAsRead,
  spam: rpc.mail.updateThreadLabels,
  trash: rpc.mail.moveThreadToTrash,
  unread: rpc.mail.markThreadAsUnread,
  unspam: rpc.mail.updateThreadLabels,
  untrash: rpc.mail.untrashThread,
};

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

  const threadQueryKey = messageToUpdate.threadId
    ? getThreadQueryKey(args.mailboxId, messageToUpdate.threadId)
    : undefined;
  const optimisticMessage = args.optimisticUpdater(messageToUpdate);
  const rollback = await applyOptimisticMailboxUpdate(
    args.queryClient,
    args.mailboxId,
    () => {
      applyMessageToCaches(
        args.queryClient,
        args.mailboxId,
        threadQueryKey,
        optimisticMessage
      );
    },
    threadQueryKey
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
    await rollback();
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
  const rollback = await applyOptimisticMailboxUpdate(
    args.queryClient,
    args.mailboxId,
    () => {
      for (const message of findMessagesInCachedMailboxQueries(
        args.queryClient,
        args.mailboxId,
        (candidate) => candidate.threadId === args.threadId
      )) {
        applyMessageToCachedMailboxQueries(
          args.queryClient,
          args.mailboxId,
          args.optimisticUpdater(message)
        );
      }
      args.queryClient.setQueryData(
        threadQueryKey,
        (currentData: ThreadMessagesResult | undefined) =>
          updateMessagesInThreadData(
            currentData,
            () => true,
            args.optimisticUpdater
          )
      );
    },
    threadQueryKey
  );

  try {
    const updatedThread = await args.mutation(args.signal);
    await applyResolvedThreadMetadataToCaches(
      args.queryClient,
      args.mailboxId,
      updatedThread
    );
    await invalidateMailboxCounts(args.queryClient);
  } catch (error) {
    await rollback();
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

  const threadQueryKey = messageToRemove.threadId
    ? getThreadQueryKey(args.mailboxId, messageToRemove.threadId)
    : undefined;
  const rollback = await applyOptimisticMailboxUpdate(
    args.queryClient,
    args.mailboxId,
    () => {
      removeMessagesFromCachedMailboxQueries(
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
    },
    threadQueryKey
  );

  try {
    await args.mutation(args.signal);
    await invalidateMailboxCounts(args.queryClient);
  } catch (error) {
    await rollback();
    throw error;
  }
};

export const updateMessageInMailbox = async (
  args: MessageActionArgs,
  operation: MailMetadataOperation
) => {
  const changes: LabelChangeSet =
    typeof operation === "string"
      ? METADATA_LABEL_CHANGES[operation]
      : operation;
  const sync = MailSyncSession.forMailbox(args.mailboxId);
  const cachedMessage = findMessageForAction(args);
  if (sync !== null && cachedMessage !== undefined) {
    await sync.command(
      args.mailboxId,
      [{ messageIds: [args.messageId], threadId: cachedMessage.threadId }],
      operation === "read" || operation === "unread"
        ? { kind: "set-read", read: operation === "read" }
        : {
            addIds: [...(changes.addLabelIds ?? [])],
            kind: "set-labels",
            removeIds: [...(changes.removeLabelIds ?? [])],
          }
    );
    return;
  }
  const mutation =
    typeof operation === "string"
      ? MESSAGE_METADATA_MUTATIONS[operation]
      : rpc.mail.updateMessageLabels;
  await runOptimisticMessageMetadataMutation({
    ...args,
    mutation: async (signal) =>
      await mutation(
        {
          addLabelIds: changes.addLabelIds
            ? [...changes.addLabelIds]
            : undefined,
          mailboxId: args.mailboxId,
          messageId: args.messageId,
          removeLabelIds: changes.removeLabelIds
            ? [...changes.removeLabelIds]
            : undefined,
        },
        { signal }
      ),
    optimisticUpdater: (message) => {
      if (operation === "read") {
        return markMessageReadLocally(message);
      }
      if (operation === "unread") {
        return markMessageUnreadLocally(message);
      }
      return applyMessageLabelChangesLocally(message, changes);
    },
  });
};

export const updateThreadInMailbox = async (
  args: {
    queryClient: QueryClient;
    mailboxId: string;
    threadId: string;
    signal?: AbortSignal;
  },
  operation: MailMetadataOperation
) => {
  const changes: LabelChangeSet =
    typeof operation === "string"
      ? METADATA_LABEL_CHANGES[operation]
      : operation;
  const sync = MailSyncSession.forMailbox(args.mailboxId);
  if (sync !== null) {
    const thread = await sync.client.thread(args.mailboxId, args.threadId);
    if (thread.messages.length === 0) {
      return;
    }
    await sync.command(
      args.mailboxId,
      [
        {
          messageIds: thread.messages.map((message) => message.id),
          threadId: args.threadId,
        },
      ],
      operation === "read" || operation === "unread"
        ? { kind: "set-read", read: operation === "read" }
        : {
            addIds: [...(changes.addLabelIds ?? [])],
            kind: "set-labels",
            removeIds: [...(changes.removeLabelIds ?? [])],
          }
    );
    return;
  }
  const mutation =
    typeof operation === "string"
      ? THREAD_METADATA_MUTATIONS[operation]
      : rpc.mail.updateThreadLabels;
  await runOptimisticThreadMetadataMutation({
    ...args,
    mutation: async (signal) =>
      await mutation(
        {
          addLabelIds: changes.addLabelIds
            ? [...changes.addLabelIds]
            : undefined,
          mailboxId: args.mailboxId,
          removeLabelIds: changes.removeLabelIds
            ? [...changes.removeLabelIds]
            : undefined,
          threadId: args.threadId,
        },
        { signal }
      ),
    optimisticUpdater: (message) => {
      if (operation === "read") {
        return markMessageReadLocally(message);
      }
      if (operation === "unread") {
        return markMessageUnreadLocally(message);
      }
      return applyThreadLabelChangesLocally(message, changes);
    },
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
