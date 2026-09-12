import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";

import { MAILBOX_LABELS } from "#/lib/mail";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/mail";
import { rpc } from "#/lib/orpc";

import { runMailMutation } from "../../mail-mutations";
import { getGmailUnreadCountsQueryKey } from "../../mailboxes-query";
import { getThreadQueryKey } from "../thread-query";
import { getMailboxThreadQueriesKey } from "../thread-query-keys";
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

export const applyBulkChangesInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  targets: MailMutationTarget[],
  command: MailCommand
) => {
  let result: Awaited<ReturnType<typeof rpc.mail.applyChanges>> | undefined;
  const messageIds = new Set(targets.flatMap((target) => target.messageIds));
  const updater = getMailCommandUpdater(command);
  await runMailMutation(queryClient, {
    apply: () => {
      updateMessagesInCachedMailboxQueries(
        queryClient,
        mailboxId,
        (message) => messageIds.has(message.id),
        updater
      );
      for (const target of targets) {
        queryClient.setQueryData(
          getThreadQueryKey(mailboxId, target.threadId),
          (current: ThreadMessagesResult | undefined) =>
            updateMessagesInThreadData(
              current,
              (message) => messageIds.has(message.id),
              updater
            )
        );
      }
    },
    execute: async () => {
      result = await rpc.mail.applyChanges({ command, mailboxId, targets });
      const applied = new Set(
        result.targets
          .filter((target) => target.status === "applied")
          .map((target) => target.threadId)
      );
      return () => {
        updateMessagesInCachedMailboxQueries(
          queryClient,
          mailboxId,
          (message) =>
            applied.has(message.threadId) && messageIds.has(message.id),
          updater
        );
        for (const target of targets.filter((item) =>
          applied.has(item.threadId)
        )) {
          queryClient.setQueryData(
            getThreadQueryKey(mailboxId, target.threadId),
            (current: ThreadMessagesResult | undefined) =>
              updateMessagesInThreadData(
                current,
                (message) => messageIds.has(message.id),
                updater
              )
          );
        }
      };
    },
    mailboxId,
    targets: targets.map((target) => target.threadId),
  });
  if (!result) {
    throw new Error("Mail update did not complete.");
  }
  return result;
};

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
    ) ??
    args.queryClient
      .getQueriesData<ThreadMessagesResult>({
        queryKey: getMailboxThreadQueriesKey(args.mailboxId),
      })
      .flatMap(([, data]) => data?.messages ?? [])
      .find((message) => message.id === args.messageId)
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
    coalesceKey?: string;
    mutation: (signal?: AbortSignal) => Promise<MessageMetadataMutationResult>;
    optimisticUpdater: (message: MessageListItem) => MessageListItem;
  }
) => {
  const original = findMessageForAction(args);
  const threadId = original?.threadId ?? args.messageId;
  const threadKey = getThreadQueryKey(args.mailboxId, threadId);
  await runMailMutation(args.queryClient, {
    apply: () => {
      const current = findMessageForAction(args) ?? original;
      if (current) {
        applyMessageToCaches(
          args.queryClient,
          args.mailboxId,
          threadKey,
          args.optimisticUpdater(current)
        );
      }
    },
    coalesceKey: args.coalesceKey,
    execute: async () => {
      args.signal?.throwIfAborted();
      // Once dispatched, a write finishes even if a newer intent arrives.
      const updated = await args.mutation();
      return () => {
        const current = findMessageForAction(args) ?? original;
        if (current) {
          applyMessageToCaches(
            args.queryClient,
            args.mailboxId,
            threadKey,
            applyMessageMetadata(current, updated)
          );
        }
      };
    },
    mailboxId: args.mailboxId,
    targets: [threadId],
  });
  await persistQueryKeys(args.queryClient, [
    threadKey,
    getMessagesQueryKey(args.mailboxId, args.mailbox, args.searchQuery),
  ]);
};

const runOptimisticThreadMetadataMutation = async (args: {
  queryClient: QueryClient;
  mailboxId: string;
  threadId: string;
  signal?: AbortSignal;
  coalesceKey?: string;
  mutation: (signal?: AbortSignal) => Promise<ThreadMetadataMutationResult>;
  optimisticUpdater: (message: MessageListItem) => MessageListItem;
}) => {
  const threadQueryKey = getThreadQueryKey(args.mailboxId, args.threadId);
  let touchedQueryKeys: (readonly unknown[])[] = [threadQueryKey];
  await runMailMutation(args.queryClient, {
    apply: () => {
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
        (current: ThreadMessagesResult | undefined) =>
          updateMessagesInThreadData(
            current,
            () => true,
            args.optimisticUpdater
          )
      );
    },
    coalesceKey: args.coalesceKey,
    execute: async () => {
      args.signal?.throwIfAborted();
      const result = await args.mutation();
      return () => {
        touchedQueryKeys = applyResolvedThreadMetadataToCaches(
          args.queryClient,
          args.mailboxId,
          result
        );
      };
    },
    mailboxId: args.mailboxId,
    targets: [args.threadId],
  });
  await persistQueryKeys(args.queryClient, touchedQueryKeys);
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
  const mutation =
    typeof operation === "string"
      ? MESSAGE_METADATA_MUTATIONS[operation]
      : rpc.mail.updateMessageLabels;
  await runOptimisticMessageMetadataMutation({
    ...args,
    coalesceKey: JSON.stringify([
      "message",
      args.messageId,
      [
        ...(changes.addLabelIds ?? []),
        ...(changes.removeLabelIds ?? []),
      ].toSorted(),
    ]),
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
  const mutation =
    typeof operation === "string"
      ? THREAD_METADATA_MUTATIONS[operation]
      : rpc.mail.updateThreadLabels;
  await runOptimisticThreadMetadataMutation({
    ...args,
    coalesceKey: JSON.stringify([
      "thread",
      args.threadId,
      [
        ...(changes.addLabelIds ?? []),
        ...(changes.removeLabelIds ?? []),
      ].toSorted(),
    ]),
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
