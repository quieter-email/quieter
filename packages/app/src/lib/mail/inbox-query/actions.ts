import { ORPCError } from "@orpc/client";
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
  removeMessagesFromQueryData,
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
  applyResolvedThreadMetadataToCaches,
  findMessageInCachedMailboxQueries,
  findMessagesInCachedMailboxQueries,
  getCachedMessagesQueries,
  persistQueryKeys,
  removeMessagesFromCachedMailboxQueries,
} from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query";
import { getMailboxThreadQueriesKey } from "@quieter/app/lib/mail/thread-query-keys";
import { rpc } from "@quieter/app/lib/orpc";
import type {
  MailCommand,
  MailMutationResult,
  MailMutationTarget,
} from "@quieter/mail/data-plane";
import { isIncomingInboxMessage } from "@quieter/mail/messages";
import type {
  MailSnoozeApplyInput,
  MailSnoozeCommand,
  MailSnoozeState,
} from "@quieter/mail/snooze";
import type { QueryClient } from "@tanstack/react-query";

type MessageActionArgs = {
  queryClient: QueryClient;
  mailboxId: string;
  mailbox: MailboxCategory;
  searchQuery: string | null | undefined;
  messageId: string;
  signal?: AbortSignal;
};

export const applySnoozeInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  targets: MailSnoozeApplyInput["targets"],
  command: MailSnoozeCommand,
  requestId: string = crypto.randomUUID()
) => {
  let result: Awaited<ReturnType<typeof rpc.mail.applySnooze>> | undefined;
  const leaveInbox = (matches: (message: MessageListItem) => boolean) => {
    for (const cachedQuery of getCachedMessagesQueries(
      queryClient,
      mailboxId
    )) {
      if (cachedQuery.mailbox !== "inbox") {
        continue;
      }
      const nextData = removeMessagesFromQueryData(cachedQuery.data, matches);
      if (nextData !== cachedQuery.data) {
        queryClient.setQueryData(cachedQuery.queryKey, nextData);
      }
    }
  };
  const applySchedule = (
    threadId: string,
    update: (state: MailSnoozeState | undefined) => MailSnoozeState | undefined,
    placeMessage?: (message: MessageListItem) => MessageListItem
  ) => {
    const updateMessage = (message: MessageListItem) => {
      const snooze = update(message.snooze);
      return snooze === message.snooze
        ? message
        : { ...(placeMessage?.(message) ?? message), snooze };
    };
    for (const message of findMessagesInCachedMailboxQueries(
      queryClient,
      mailboxId,
      (item) => item.threadId === threadId
    )) {
      const next = updateMessage(message);
      if (next !== message) {
        applyMessageToCachedMailboxQueries(queryClient, mailboxId, next);
      }
    }
    queryClient.setQueryData(
      getThreadQueryKey(mailboxId, threadId),
      (current: ThreadMessagesResult | undefined) => {
        if (!current) {
          return current;
        }
        const snooze = update(current.snooze);
        const next = updateMessagesInThreadData(
          current,
          () => true,
          updateMessage
        );
        return snooze === current.snooze
          ? next
          : { ...current, ...next, snooze };
      }
    );
  };
  const requestedMessageIds = new Set(
    targets.flatMap((target) => target.messageIds)
  );
  const requestedThreadIds = new Set(targets.map((target) => target.threadId));
  await runMailMutation(queryClient, {
    apply: () => {
      if (command.kind === "snooze") {
        leaveInbox((message) => requestedThreadIds.has(message.threadId));
      }
      if (command.kind === "reschedule" || command.kind === "cancel") {
        for (const target of targets) {
          applySchedule(target.threadId, (state) => {
            if (!state || state.version !== target.expectedVersion) {
              return state;
            }
            return command.kind === "reschedule"
              ? {
                  ...state,
                  returnAt: command.returnAt,
                  timeZone: command.timeZone,
                }
              : { ...state, status: "cancelled" };
          });
        }
      }
    },
    execute: async () => {
      const confirmed = await rpc.mail.applySnooze({
        command,
        mailboxId,
        requestId,
        targets,
      });
      result = confirmed;
      return () => {
        for (const target of confirmed.targets) {
          if (target.status !== "applied" || target.replayed === true) {
            continue;
          }
          const { snooze } = target;
          const messageIds = new Set(target.messageIds);
          if (snooze !== undefined) {
            const placement =
              command.kind === "snooze" || command.kind === "return-now"
                ? getMailCommandUpdater({
                    kind: "set-placement",
                    placement: command.kind === "snooze" ? "done" : "inbox",
                  })
                : undefined;
            applySchedule(
              target.threadId,
              (state) =>
                (state?.version ?? -1) <= snooze.version ? snooze : state,
              placement &&
                ((message) =>
                  messageIds.has(message.id) ? placement(message) : message)
            );
          }
          if (command.kind === "snooze") {
            leaveInbox(
              (message) =>
                message.threadId === target.threadId &&
                (snooze === undefined
                  ? message.snooze === undefined
                  : (message.snooze?.version ?? -1) <= snooze.version) &&
                (target.messageIds === undefined
                  ? requestedMessageIds.has(message.id)
                  : messageIds.has(message.id))
            );
          }
        }
      };
    },
    mailboxId,
    targets: targets.map((target) => target.threadId),
  });
  if (!result) {
    throw new Error("The conversation update did not complete.");
  }
  return result;
};

export const applyBulkChangesInMailbox = async (
  queryClient: QueryClient,
  mailboxId: string,
  targets: MailMutationTarget[],
  command: MailCommand
) => {
  let result: MailMutationResult | undefined;
  const updater = getMailCommandUpdater(command);
  const requestId =
    command.kind === "delete-permanently" ? undefined : crypto.randomUUID();
  const input = { command, mailboxId, requestId, targets };
  const apply = (
    appliedTargets: MailMutationTarget[],
    outcomes?: ReadonlyMap<string, MailMutationResult["targets"][number]>
  ) => {
    for (const target of appliedTargets) {
      const messageIds = new Set(target.messageIds);
      const wholeThread =
        command.kind === "set-importance" && messageIds.size === 0;
      const outcome = outcomes?.get(target.threadId);
      const summary = outcome?.summary;
      const untrashed = new Set(outcome?.untrashedMessageIds);
      for (const id of outcome?.appliedMessageIds ?? []) {
        untrashed.delete(id);
      }
      const threadKey = getThreadQueryKey(mailboxId, target.threadId);
      const listMessages = findMessagesInCachedMailboxQueries(
        queryClient,
        mailboxId,
        (candidate) => candidate.threadId === target.threadId
      );
      const placementRows =
        command.kind === "set-placement"
          ? [
              ...listMessages,
              ...(queryClient.getQueryData<ThreadMessagesResult>(threadKey)
                ?.messages ?? []),
            ]
          : [];
      const inboxIsKnown = placementRows.some(
        (message) => message.threadInboxIncomingMessageIds !== undefined
      );
      const inboxIds = new Set(
        placementRows.flatMap((message) => [
          ...(message.threadInboxIncomingMessageIds ?? []),
          ...(isIncomingInboxMessage(message) ? [message.id] : []),
        ])
      );
      if (command.kind === "set-placement" && inboxIsKnown) {
        if (command.placement === "done") {
          for (const messageId of messageIds) {
            inboxIds.delete(messageId);
          }
        } else {
          for (const message of placementRows) {
            if (
              messageIds.has(message.id) &&
              isIncomingInboxMessage(updater(message))
            ) {
              inboxIds.add(message.id);
            }
          }
        }
      }
      const includesMessage = (message: MessageListItem) =>
        command.kind === "set-importance" ||
        (command.kind === "set-placement" && inboxIsKnown) ||
        messageIds.has(message.id);
      const update = (message: MessageListItem) => {
        let next = message;
        if (untrashed.has(message.id)) {
          next = applyMessageLabelChangesLocally(message, {
            removeLabelIds: [MAILBOX_LABELS.trash],
          });
        } else if (wholeThread || messageIds.has(message.id)) {
          next = updater(message);
        }
        if (command.kind === "set-placement" && inboxIsKnown) {
          const threadLabelIds = next.threadLabelIds ?? next.labelIds ?? [];
          return {
            ...next,
            threadInboxIncomingMessageIds: [...inboxIds],
            threadLabelIds:
              inboxIds.size === 0
                ? threadLabelIds.filter((id) => id !== MAILBOX_LABELS.inbox)
                : [...new Set([...threadLabelIds, MAILBOX_LABELS.inbox])],
          };
        }
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
      for (const message of listMessages.filter(includesMessage)) {
        applyMessageToCachedMailboxQueries(
          queryClient,
          mailboxId,
          update(message)
        );
      }
      queryClient.setQueryData(
        threadKey,
        (current: ThreadMessagesResult | undefined) =>
          updateMessagesInThreadData(current, includesMessage, update)
      );
    }
  };
  await runMailMutation(queryClient, {
    apply: () => {
      apply(targets);
    },
    execute: async () => {
      let confirmed: MailMutationResult;
      try {
        confirmed = await rpc.mail.applyChanges(input);
      } catch (error) {
        if (requestId === undefined || !(error instanceof TypeError)) {
          throw error;
        }
        confirmed = await rpc.mail.applyChanges(input);
      }
      if (confirmed.receipt?.retryable === true) {
        try {
          confirmed = await rpc.mail.applyChanges(input);
        } catch (error) {
          if (!(error instanceof TypeError)) {
            throw error;
          }
        }
      }
      result = confirmed;
      const outcomes = new Map(
        confirmed.targets.map((target) => [target.threadId, target])
      );
      return () => {
        if (confirmed.receipt?.replayed === true) {
          return;
        }
        apply(
          targets.flatMap((target) => {
            const outcome = outcomes.get(target.threadId);
            if (!outcome || outcome.replayed === true) {
              return [];
            }
            if (
              outcome.appliedMessageIds !== undefined ||
              outcome.untrashedMessageIds !== undefined
            ) {
              const messageIds = [
                ...(outcome.appliedMessageIds ?? []),
                ...(outcome.untrashedMessageIds ?? []),
              ];
              return messageIds.length > 0 ? [{ ...target, messageIds }] : [];
            }
            if (
              outcome.status !== "applied" ||
              confirmed.receipt?.status === "pending" ||
              confirmed.receipt?.status === "uncertain"
            ) {
              return [];
            }
            return [
              {
                ...target,
                messageIds: outcome.messageIds ?? target.messageIds,
              },
            ];
          }),
          outcomes
        );
      };
    },
    mailboxId,
    targets: targets.map((target) => target.threadId),
  });
  if (!result) {
    throw new Error("Mail update did not complete.");
  }
  const resolvedThreads = new Set(
    result.targets.map((target) => target.threadId)
  );
  if (
    result.receipt?.status === "pending" ||
    result.receipt?.status === "uncertain" ||
    targets.some((target) => !resolvedThreads.has(target.threadId))
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        result.targets.find((target) => target.status === "failed")?.message ??
        "This action is still being confirmed. Refresh before trying again.",
    });
  }
  return result;
};

const METADATA_LABEL_CHANGES = {
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
  read: rpc.mail.markMessageAsRead,
  spam: rpc.mail.updateMessageLabels,
  trash: rpc.mail.moveMessageToTrash,
  unread: rpc.mail.markMessageAsUnread,
  unspam: rpc.mail.updateMessageLabels,
  untrash: rpc.mail.untrashMessage,
};
const THREAD_METADATA_MUTATIONS = {
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

const applyMessageToCaches = (
  queryClient: QueryClient,
  mailboxId: string,
  threadQueryKey: ReturnType<typeof getThreadQueryKey>,
  nextMessage: MessageListItem
) => {
  applyMessageToCachedMailboxQueries(queryClient, mailboxId, nextMessage);
  queryClient.setQueryData(
    threadQueryKey,
    (currentData: ThreadMessagesResult | undefined) =>
      updateMessageInThreadData(currentData, nextMessage.id, (message) =>
        mergeMessagePreservingLoadedDetails(message, nextMessage)
      )
  );
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
      const current = findMessageForAction(args);
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
        const current = findMessageForAction(args);
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
        applyResolvedThreadMetadataToCaches(
          args.queryClient,
          args.mailboxId,
          result
        );
      };
    },
    mailboxId: args.mailboxId,
    targets: [args.threadId],
  });
};

const runOptimisticMessageRemoval = async (
  args: MessageActionArgs & {
    mutation: (signal?: AbortSignal) => Promise<void>;
  }
) => {
  const messageToRemove = findMessageForAction(args);
  const threadId = messageToRemove?.threadId ?? args.messageId;
  const remove = () => {
    removeMessagesFromCachedMailboxQueries(
      args.queryClient,
      args.mailboxId,
      (message) => message.id === args.messageId
    );
    args.queryClient.setQueryData(
      getThreadQueryKey(args.mailboxId, threadId),
      (current: ThreadMessagesResult | undefined) =>
        removeMessagesFromThreadData(
          current,
          (message) => message.id === args.messageId
        )
    );
  };
  await runMailMutation(args.queryClient, {
    apply: remove,
    execute: async () => {
      await args.mutation(args.signal);
      return remove;
    },
    mailboxId: args.mailboxId,
    targets: [threadId],
  });
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
