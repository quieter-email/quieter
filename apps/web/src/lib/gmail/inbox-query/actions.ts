import type { MailCommand, MailMutationTarget } from "@quieter/mail/data-plane";
import type { QueryClient } from "@tanstack/react-query";

import type { MailboxCategory, ThreadMessagesResult } from "#/lib/mail";
import { MailSyncSession } from "#/lib/mail-sync/session";
import { rpc } from "#/lib/orpc";

import { getGmailUnreadCountsQueryKey } from "../../mailboxes-query";
import { getThreadQueryKey } from "../thread-query";
import { getMailboxThreadQueriesKey } from "../thread-query-keys";
import { removeMessagesFromThreadData } from "./data";
import type { LabelChangeSet, MessagesQueryData } from "./data";
import { getMessagesQueryKey } from "./keys";
import {
  applyOptimisticMailboxUpdate,
  findMessageInCachedMailboxQueries,
  removeMessagesFromCachedMailboxQueries,
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
  mailboxId: string,
  targets: MailMutationTarget[],
  command: MailCommand
) => {
  const sync = await MailSyncSession.waitForMailbox(mailboxId);
  return await sync.command(mailboxId, targets, command);
};

export type MailMetadataOperation =
  | "archive"
  | "read"
  | "unread"
  | "spam"
  | "trash"
  | "unspam"
  | "untrash"
  | LabelChangeSet;

const metadataCommand = (operation: MailMetadataOperation): MailCommand => {
  if (operation === "read" || operation === "unread") {
    return { kind: "set-read", read: operation === "read" };
  }
  if (typeof operation === "string") {
    return {
      destination:
        operation === "unspam" || operation === "untrash" ? "inbox" : operation,
      kind: "move",
    };
  }
  return {
    addIds: [...(operation.addLabelIds ?? [])],
    kind: "set-labels",
    removeIds: [...(operation.removeLabelIds ?? [])],
  };
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
      .flatMap(([, thread]) => thread?.messages ?? [])
      .find((message) => message.id === args.messageId)
  );
};

const invalidateMailboxCounts = async (queryClient: QueryClient) => {
  await queryClient.invalidateQueries({
    queryKey: getGmailUnreadCountsQueryKey(),
  });
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
  const sync = await MailSyncSession.waitForMailbox(
    args.mailboxId,
    args.signal
  );
  const cachedMessage = findMessageForAction(args);
  if (cachedMessage === undefined) {
    throw new Error("Message is no longer available. Refresh and try again.");
  }
  await sync.command(
    args.mailboxId,
    [{ messageIds: [args.messageId], threadId: cachedMessage.threadId }],
    metadataCommand(operation)
  );
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
  const sync = await MailSyncSession.waitForMailbox(
    args.mailboxId,
    args.signal
  );
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
    metadataCommand(operation)
  );
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

export const removeDraftMessageFromCaches = (
  queryClient: QueryClient,
  mailboxId: string,
  messageId: string,
  threadId?: string | null
) => {
  removeMessagesFromCachedMailboxQueries(
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
};
