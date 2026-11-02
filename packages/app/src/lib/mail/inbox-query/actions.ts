import { MAILBOX_LABELS } from "@quieter/app/lib/mail";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import { runMailMutation } from "@quieter/app/lib/mail-mutations";
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
} from "@quieter/app/lib/mail/inbox-query/data";
import type {
  LabelChangeSet,
  MessageMetadataMutationResult,
  MessagesQueryData,
  ThreadMetadataMutationResult,
} from "@quieter/app/lib/mail/inbox-query/data";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/keys";
import {
  applyMessageToCachedMailboxQueries,
  applyOptimisticMailboxUpdate,
  applyResolvedThreadMetadataToCaches,
  findMessageInCachedMailboxQueries,
  findMessagesInCachedMailboxQueries,
  persistQueryKeys,
  removeMessagesFromCachedMailboxQueries,
} from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query";
import { getMailboxThreadQueriesKey } from "@quieter/app/lib/mail/thread-query-keys";
import { getGmailUnreadCountsQueryKey } from "@quieter/app/lib/mailboxes-query";
import { rpc } from "@quieter/app/lib/orpc";
import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";

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
  const updater = getMailCommandUpdater(command);
  const apply = (
    appliedTargets: MailMutationTarget[],
    confirmed?: NonNullable<typeof result>
  ) => {
    for (const target of appliedTargets) {
      const messageIds = new Set(target.messageIds);
      const wholeThread =
        command.kind === "set-importance" && messageIds.size === 0;
      const summary = confirmed?.targets.find(
        (item) => item.threadId === target.threadId
      )?.summary;
      const update = (message: MessageListItem) => {
        const next =
          wholeThread || messageIds.has(message.id)
            ? updater(message)
            : message;
        if (command.kind !== "set-importance") {
          return next;
        }
        return {
          ...next,
          threadIsImportant:
            summary?.isImportant ??
            (wholeThread
              ? command.important
              : command.important || (message.threadIsImportant ?? false)),
        };
      };
      for (const message of findMessagesInCachedMailboxQueries(
        queryClient,
        mailboxId,
        (candidate) =>
          candidate.threadId === target.threadId &&
          (command.kind === "set-importance" || messageIds.has(candidate.id))
      )) {
        applyMessageToCachedMailboxQueries(
          queryClient,
          mailboxId,
          update(message)
        );
      }
      queryClient.setQueryData(
        getThreadQueryKey(mailboxId, target.threadId),
        (current: ThreadMessagesResult | undefined) =>
          updateMessagesInThreadData(
            current,
            (message) =>
              command.kind === "set-importance" || messageIds.has(message.id),
            update
          )
      );
    }
  };
  await runMailMutation(queryClient, {
    apply: () => {
      apply(targets);
    },
    execute: async () => {
      result = await rpc.mail.applyChanges({ command, mailboxId, targets });
      const confirmed = result;
      const applied = new Set(
        confirmed.targets
          .filter((target) => target.status === "applied")
          .map((target) => target.threadId)
      );
      return () => {
        apply(
          targets.filter((target) => applied.has(target.threadId)),
          confirmed
        );
      };
    },
    mailboxId,
    targets: targets.map((target) => target.threadId),
  });
  if (!result) {
    throw new Error("Mail update did not complete.");
  }
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey:
        command.kind === "set-importance"
          ? ["messages", mailboxId]
          : ["messages", mailboxId, "important"],
    }),
    ...(command.kind === "set-read"
      ? []
      : [
          queryClient.invalidateQueries({
            queryKey: getMailboxThreadQueriesKey(mailboxId),
          }),
        ]),
  ]);
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
  if (operation !== "read" && operation !== "unread") {
    await Promise.all([
      args.queryClient.invalidateQueries({
        queryKey: ["messages", args.mailboxId, "important"],
      }),
      args.queryClient.invalidateQueries({
        queryKey: getMailboxThreadQueriesKey(args.mailboxId),
      }),
    ]);
  } else {
    await args.queryClient.invalidateQueries({
      queryKey: ["messages", args.mailboxId, "important"],
    });
  }
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
  if (operation !== "read" && operation !== "unread") {
    await Promise.all([
      args.queryClient.invalidateQueries({
        queryKey: ["messages", args.mailboxId, "important"],
      }),
      args.queryClient.invalidateQueries({
        queryKey: getMailboxThreadQueriesKey(args.mailboxId),
      }),
    ]);
  } else {
    await args.queryClient.invalidateQueries({
      queryKey: ["messages", args.mailboxId, "important"],
    });
  }
};

export const deleteDraftInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery: string | null | undefined,
  messageId: string,
  draftId: string,
  baseRevision?: string,
  signal?: AbortSignal
) => {
  await runOptimisticMessageRemoval({
    mailbox,
    mailboxId,
    messageId,
    mutation: async (mutationSignal) => {
      await rpc.mail.deleteDraft(
        { baseRevision, draftId, mailboxId },
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
