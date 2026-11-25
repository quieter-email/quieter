"use client";

import { ORPCError } from "@orpc/client";
import { toastError } from "@quieter/app/lib/error-toast";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import type {
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import {
  applyBulkChangesInMailbox,
  applySnoozeInMailbox,
  updateMessageInMailbox,
  updateThreadInMailbox,
  deleteDraftInMailbox,
} from "@quieter/app/lib/mail/inbox-query/index";
import type { MailMetadataOperation } from "@quieter/app/lib/mail/inbox-query/index";
import { findMessagesInCachedMailboxQueries } from "@quieter/app/lib/mail/inbox-query/query-cache";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import type { MailCommand } from "@quieter/mail/data-plane";
import type { MailSnoozeCommand, MailSnoozeState } from "@quieter/mail/snooze";
import type { QueryClient } from "@tanstack/react-query";

import { settleMailSnoozeRequest } from "../domain/mail-snooze";
import type {
  MailSnoozeAttempt,
  PendingMailSnoozeRequest,
} from "../domain/mail-snooze";

type LabelChangeSet = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

type ThreadLabelUpdate = LabelChangeSet & { threadId: string };

const BULK_ACTION_CONCURRENCY = 3;

type MailboxActionHandlerArgs = {
  activeMailbox: MailboxCategory;
  activeSearchQuery: string;
  queryClient: QueryClient;
  refreshSearchResultsIfNeeded: () => Promise<void>;
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isThreadActionPending: (threadId: string | null | undefined) => boolean;
  setMessageActionPending: (messageId: string, pending: boolean) => void;
  setMessageActionsPending: (messageIds: string[], pending: boolean) => void;
  setThreadActionPending: (threadId: string, pending: boolean) => void;
  setThreadActionsPending: (threadIds: string[], pending: boolean) => void;
  unsubscribeFromMessageMutation: (messageId: string) => Promise<boolean>;
  mailboxId: string;
};

export type MailboxPendingActions = {
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isThreadActionPending: (threadId: string | null | undefined) => boolean;
};

const getUniqueIds = (ids: readonly string[]) => [
  ...new Set(
    ids.flatMap((id) => {
      const normalizedId = id.trim();
      return normalizedId ? [normalizedId] : [];
    })
  ),
];

export const createMailboxActionHandlers = ({
  activeMailbox,
  activeSearchQuery,
  queryClient,
  refreshSearchResultsIfNeeded,
  isMessageActionPending,
  isThreadActionPending,
  setMessageActionPending,
  setMessageActionsPending,
  setThreadActionPending,
  setThreadActionsPending,
  unsubscribeFromMessageMutation,
  mailboxId,
}: MailboxActionHandlerArgs) => {
  const runAction = async (
    scope: "message" | "thread",
    id: string,
    action: () => Promise<void>
  ) => {
    const isPending =
      scope === "message" ? isMessageActionPending : isThreadActionPending;
    if (isPending(id)) {
      return;
    }
    const setPending =
      scope === "message" ? setMessageActionPending : setThreadActionPending;

    setPending(id, true);
    try {
      await action();
      await refreshSearchResultsIfNeeded();
    } finally {
      setPending(id, false);
    }
  };

  const runBulkAction = async ({
    action,
    ids,
    isPending,
    setPending,
  }: {
    action: (id: string) => Promise<void>;
    ids: readonly string[];
    isPending: (id: string) => boolean;
    setPending: (ids: string[], pending: boolean) => void;
  }) => {
    const actionableIds = getUniqueIds(ids).filter((id) => !isPending(id));
    if (actionableIds.length === 0) {
      return;
    }

    setPending(actionableIds, true);
    let actionError: unknown;
    let shouldRefreshSearchResults = false;

    try {
      let nextIndex = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(BULK_ACTION_CONCURRENCY, actionableIds.length) },
          async () => {
            while (nextIndex < actionableIds.length) {
              const id = actionableIds[nextIndex];
              nextIndex += 1;
              if (!id) {
                continue;
              }

              try {
                // The worker pool intentionally serializes each lane while
                // keeping the overall bulk action concurrency bounded.
                await action(id);
                shouldRefreshSearchResults = true;
              } catch (error) {
                actionError ??= error;
              }
            }
          }
        )
      );
    } catch (error) {
      actionError = error;
    } finally {
      setPending(actionableIds, false);
    }

    if (shouldRefreshSearchResults) {
      try {
        await refreshSearchResultsIfNeeded();
      } catch (refreshError) {
        if (actionError === undefined) {
          throw refreshError instanceof Error
            ? refreshError
            : new Error("Refreshing search results failed.", {
                cause: refreshError,
              });
        }
      }
    }

    if (actionError !== undefined) {
      throw actionError instanceof Error
        ? actionError
        : new Error("Mailbox action failed.", { cause: actionError });
    }
  };

  const runMailboxMessageAction = async (
    messageId: string,
    operation: MailMetadataOperation
  ) => {
    await updateMessageInMailbox(
      {
        mailbox: activeMailbox,
        mailboxId,
        messageId,
        queryClient,
        searchQuery: activeSearchQuery,
      },
      operation
    );
    await refreshSearchResultsIfNeeded();
  };
  const runMailboxThreadAction = async (
    threadId: string,
    operation: MailMetadataOperation
  ) => {
    await updateThreadInMailbox(
      { mailboxId, queryClient, threadId },
      operation
    );
    await refreshSearchResultsIfNeeded();
  };
  const runBulkMailboxCommand = async (
    threads: ThreadListEntry[],
    command: MailCommand
  ) => {
    const result = await applyBulkChangesInMailbox(
      queryClient,
      mailboxId,
      threads.map((thread) => ({
        messageIds:
          command.kind === "set-importance"
            ? []
            : thread.messages.map((message) => message.id),
        threadId: thread.threadId,
      })),
      command
    );
    await refreshSearchResultsIfNeeded();
    const failed = result.targets.find((target) => target.status === "failed");
    if (failed) {
      throw new Error("Could not update some messages.");
    }
  };

  const setPlacement = async (
    targets: { threadId: string; messages: MessageListItem[] }[],
    placement: "done" | "inbox"
  ) => {
    const selectedMailbox = queryClient
      .getQueryData(mailboxesQueryOptions().queryKey)
      ?.groups.flatMap((group) => group.mailboxes)
      .find((mailbox) => mailbox.id === mailboxId);
    if (selectedMailbox?.capabilities.canSetPlacement !== true) {
      throw new ORPCError("FORBIDDEN", {
        message: "You cannot change placement in this inbox.",
      });
    }
    if (targets.some((target) => isThreadActionPending(target.threadId))) {
      throw new ORPCError("CONFLICT", {
        message:
          "A selected conversation is still being updated. Wait for it to finish.",
      });
    }
    if (targets.length === 0) {
      return;
    }
    if (targets.some((target) => target.messages.length === 0)) {
      throw new ORPCError("CONFLICT", {
        message: "This conversation changed. Refresh it before trying again.",
      });
    }
    const threadIds = targets.map((target) => target.threadId);
    setThreadActionsPending(threadIds, true);
    try {
      const result = await applyBulkChangesInMailbox(
        queryClient,
        mailboxId,
        targets.map((target) => ({
          messageIds: getUniqueIds(
            target.messages.map((message) => message.id)
          ),
          threadId: target.threadId,
        })),
        { kind: "set-placement", placement }
      );
      await refreshSearchResultsIfNeeded();
      const failure = result.targets.find(
        (target) => target.status === "failed"
      );
      if (failure) {
        throw new ORPCError("CONFLICT", {
          message:
            failure.message ??
            "Some conversations could not be updated. Refresh before trying again.",
        });
      }
    } finally {
      setThreadActionsPending(threadIds, false);
    }
  };

  const setSingleThreadPlacement = async (
    threadId: string,
    placement: "done" | "inbox"
  ) => {
    const thread = queryClient.getQueryData<ThreadMessagesResult>(
      getThreadQueryKey(mailboxId, threadId)
    );
    const messages = [
      ...(thread?.messages ?? []),
      ...findMessagesInCachedMailboxQueries(
        queryClient,
        mailboxId,
        (message) => message.threadId === threadId
      ),
    ];
    await setPlacement([{ messages, threadId }], placement);
  };

  const applySnooze = async (
    targets: {
      threadId: string;
      messages: MessageListItem[];
      snooze?: MailSnoozeState;
      expectedVersion?: number | null;
    }[],
    command: MailSnoozeCommand,
    attempt: MailSnoozeAttempt = new Map()
  ) => {
    const mailbox = queryClient
      .getQueryData(mailboxesQueryOptions().queryKey)
      ?.groups.flatMap((group) => group.mailboxes)
      .find((candidate) => candidate.id === mailboxId);
    if (mailbox?.capabilities.canSetPlacement !== true) {
      throw new ORPCError("FORBIDDEN", {
        message: "You cannot change placement in this inbox.",
      });
    }
    if (targets.some((target) => isThreadActionPending(target.threadId))) {
      throw new ORPCError("CONFLICT", {
        message:
          "A selected conversation is still being updated. Wait for it to finish.",
      });
    }
    if (targets.length === 0) {
      return;
    }
    const threadIds = targets.map((target) => target.threadId);
    let pending: PendingMailSnoozeRequest[] = [
      {
        openThreadIds: new Set(threadIds),
        requestId: crypto.randomUUID(),
        targets: targets.map((target) => {
          const states = [
            target.snooze,
            ...target.messages.map((message) => message.snooze),
          ].filter((state): state is MailSnoozeState => state !== undefined);
          const state = states
            .toSorted((left, right) => right.version - left.version)
            .at(0);
          return {
            expectedVersion:
              target.expectedVersion === undefined
                ? (state?.version ?? null)
                : target.expectedVersion,
            messageIds:
              command.kind === "snooze"
                ? getUniqueIds(
                    target.messages.flatMap((message) => [
                      message.id,
                      ...(message.threadInboxIncomingMessageIds ?? []),
                    ])
                  )
                : [],
            threadId: target.threadId,
          };
        }),
      },
    ];
    const resume = async () => {
      setThreadActionsPending(threadIds, true);
      let failure: Error | undefined;
      try {
        const remaining: PendingMailSnoozeRequest[] = [];
        for (const request of pending) {
          try {
            const settled = settleMailSnoozeRequest(
              request,
              await applySnoozeInMailbox(
                queryClient,
                mailboxId,
                request.targets,
                command,
                request.requestId
              )
            );
            remaining.push(...settled.pending);
            if (settled.failure) {
              failure ??= new ORPCError("CONFLICT", {
                message:
                  settled.failure.message ??
                  "Some conversations could not be updated. Refresh before trying again.",
              });
            }
          } catch (error) {
            // The response may be lost after the server accepted the request.
            remaining.push(request);
            failure ??=
              error instanceof Error
                ? error
                : new Error("Mailbox action failed.", { cause: error });
          }
        }
        pending = remaining;
        await refreshSearchResultsIfNeeded();
      } finally {
        setThreadActionsPending(threadIds, false);
      }
      if (failure) {
        throw failure;
      }
      attempt.delete(mailboxId);
    };
    attempt.set(mailboxId, resume);
    await resume();
  };

  const deleteDraft = async (message: MessageListItem) => {
    const { draftId } = message;
    if (!draftId) {
      return;
    }

    await runAction("message", message.id, async () => {
      await deleteDraftInMailbox(
        queryClient,
        mailboxId,
        activeMailbox,
        activeSearchQuery,
        message.id,
        draftId,
        message.baseRevision
      );
    });
  };

  const deleteDrafts = async (threads: ThreadListEntry[]) => {
    const draftsByMessageId = new Map(
      threads.flatMap((thread) => {
        const message = thread.anchorMessage;
        return message.draftId ? [[message.id, message] as const] : [];
      })
    );

    await runBulkAction({
      action: async (messageId) => {
        const message = draftsByMessageId.get(messageId);
        if (!message?.draftId) {
          return;
        }
        await deleteDraftInMailbox(
          queryClient,
          mailboxId,
          activeMailbox,
          activeSearchQuery,
          messageId,
          message.draftId,
          message.baseRevision
        );
      },
      ids: [...draftsByMessageId.keys()],
      isPending: isMessageActionPending,
      setPending: setMessageActionsPending,
    });
  };

  return {
    applyThreadSnooze: async (
      threadId: string,
      command: MailSnoozeCommand,
      expectedVersion?: number | null,
      attempt?: MailSnoozeAttempt
    ) => {
      const thread = queryClient.getQueryData<ThreadMessagesResult>(
        getThreadQueryKey(mailboxId, threadId)
      );
      await applySnooze(
        [
          {
            expectedVersion,
            messages: [
              ...(thread?.messages ?? []),
              ...findMessagesInCachedMailboxQueries(
                queryClient,
                mailboxId,
                (message) => message.threadId === threadId
              ),
            ],
            snooze: thread?.snooze,
            threadId,
          },
        ],
        command,
        attempt
      );
    },
    applyThreadsSnooze: async (
      threads: ThreadListEntry[],
      command: MailSnoozeCommand,
      attempt?: MailSnoozeAttempt
    ) => {
      await applySnooze(threads, command, attempt);
    },
    get canMarkRead() {
      return (
        queryClient
          .getQueryData(mailboxesQueryOptions().queryKey)
          ?.groups.flatMap((group) => group.mailboxes)
          .find((mailbox) => mailbox.id === mailboxId)?.capabilities
          .canMarkRead === true
      );
    },
    get canSetImportance() {
      return (
        queryClient
          .getQueryData(mailboxesQueryOptions().queryKey)
          ?.groups.flatMap((group) => group.mailboxes)
          .find((mailbox) => mailbox.id === mailboxId)?.capabilities
          .canSetImportance === true
      );
    },
    get canSetPlacement() {
      return (
        queryClient
          .getQueryData(mailboxesQueryOptions().queryKey)
          ?.groups.flatMap((group) => group.mailboxes)
          .find((mailbox) => mailbox.id === mailboxId)?.capabilities
          .canSetPlacement === true
      );
    },
    deleteDraft,
    deleteDrafts,
    markMessageAsRead: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "read");
    },
    markMessageAsSpam: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "spam");
    },
    markMessageAsUnread: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "unread");
    },
    markThreadAsRead: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "read");
    },
    markThreadAsSpam: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "spam");
    },
    markThreadAsUnread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "unread");
    },
    markThreadDone: async (threadId: string) => {
      await setSingleThreadPlacement(threadId, "done");
    },
    markThreadsAsRead: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, { kind: "set-read", read: true });
    },
    markThreadsAsSpam: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "spam",
        kind: "move",
      });
    },
    markThreadsAsUnread: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, { kind: "set-read", read: false });
    },
    markThreadsDone: async (threads: ThreadListEntry[]) => {
      await setPlacement(threads, "done");
    },
    moveMessageToTrash: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "trash");
    },
    moveThreadToTrash: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "trash");
    },
    moveThreadsToTrash: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "trash",
        kind: "move",
      });
    },
    get placementScope(): "personal" | "shared" {
      return queryClient
        .getQueryData(mailboxesQueryOptions().queryKey)
        ?.groups.flatMap((group) => group.mailboxes)
        .find((mailbox) => mailbox.id === mailboxId)?.accessMode === "shared"
        ? "shared"
        : "personal";
    },
    returnThreadToInbox: async (threadId: string) => {
      await setSingleThreadPlacement(threadId, "inbox");
    },
    returnThreadsToInbox: async (threads: ThreadListEntry[]) => {
      await setPlacement(threads, "inbox");
    },
    setThreadImportance: async (threadId: string, important: boolean) => {
      await runAction("thread", threadId, async () => {
        const result = await applyBulkChangesInMailbox(
          queryClient,
          mailboxId,
          [{ messageIds: [], threadId }],
          { important, kind: "set-importance" }
        );
        const failed = result.targets.find(
          (target) => target.status === "failed"
        );
        if (failed) {
          throw new Error("Could not update this conversation.");
        }
      });
    },
    setThreadsImportance: async (
      threads: ThreadListEntry[],
      important: boolean
    ) => {
      await runBulkMailboxCommand(threads, {
        important,
        kind: "set-importance",
      });
    },
    unmarkMessageAsSpam: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "unspam");
    },
    unmarkThreadAsSpam: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "unspam");
    },
    unmarkThreadsAsSpam: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "inbox",
        kind: "move",
      });
    },
    unsubscribeFromMessage: async (messageId: string) => {
      if (isMessageActionPending(messageId)) {
        return false;
      }
      setMessageActionPending(messageId, true);
      try {
        return await unsubscribeFromMessageMutation(messageId);
      } catch (error) {
        toastError(error, { boundary: "unsubscribe" });
        return false;
      } finally {
        setMessageActionPending(messageId, false);
      }
    },
    untrashMessage: async (messageId: string) => {
      await runMailboxMessageAction(messageId, "untrash");
    },
    untrashThread: async (threadId: string) => {
      await runMailboxThreadAction(threadId, "untrash");
    },
    untrashThreads: async (threads: ThreadListEntry[]) => {
      await runBulkMailboxCommand(threads, {
        destination: "inbox",
        kind: "move",
      });
    },
    updateMessageLabels: async (messageId: string, changes: LabelChangeSet) => {
      await runMailboxMessageAction(messageId, changes);
    },
    updateThreadLabels: async (threadId: string, changes: LabelChangeSet) => {
      await runMailboxThreadAction(threadId, changes);
    },
    updateThreadsLabels: async (updates: readonly ThreadLabelUpdate[]) => {
      await Promise.all(
        updates.map(async ({ threadId, ...changes }) => {
          await runMailboxThreadAction(threadId, changes);
        })
      );
    },
  };
};

export type MailboxActions = ReturnType<typeof createMailboxActionHandlers>;
