import { ORPCError } from "@orpc/server";
import { serverEnv } from "@quieter/env/server";
import type { GmailMetadataChange } from "@quieter/gmail";
import {
  batchModifyMessages,
  mutateGmailMessage,
  mutateGmailThread,
  getGmailMessageThreadAssociations,
  getThreadWithDetails,
  isGmailServiceError,
} from "@quieter/gmail";
import type { MailMutationResult } from "@quieter/mail/data-plane";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";

import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import {
  refreshGmailCapturedMessageMetadata,
  writeGmailCapturedMessage,
} from "../mail-capture";
import { setMailImportance } from "../mail-importance";
import { publishMailUpdate } from "../mail-updates";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  updateManagedThreadLabels,
  updateSingleManagedMessageLabels,
} from "../managed-mail/labels/service";
import {
  setManagedMessageMailboxState,
  setManagedMessageReadState,
  setManagedThreadMailboxState,
  setManagedThreadReadState,
  applyManagedMessageChanges,
} from "../managed-mail/messages/service";
import {
  executeMailCommandWithReceipt,
  isRejectedGmailWrite,
} from "./command-receipt";
import {
  learnAiMemoryFromGmailAction,
  learnAiMemoryFromMailAction,
  recordLabelFeedback,
} from "./feedback";
import type { MailInputs } from "./inputs";
import { applyMailPlacement, supersedePendingMailPlacement } from "./placement";
import { authorizeMailPlacement } from "./placement-access";

type MetadataOperation =
  | "read"
  | "unread"
  | "trash"
  | "untrash"
  | {
      addLabelIds?: string[];
      removeLabelIds?: string[];
    };

type MessageMutationArgs = {
  context: MailRequestContext;
  input: { mailboxId: string; messageId: string };
};

const recordMetadataAction = async (
  {
    accessToken,
    context,
    labelFeedback,
    input,
  }: {
    accessToken?: string;
    context: MailRequestContext;
    labelFeedback?: Awaited<ReturnType<typeof recordLabelFeedback>>;
    input: { mailboxId: string };
  },
  operation: MetadataOperation | `move:${string}`,
  messageIds: string[]
) => {
  if (messageIds.length === 0) {
    return;
  }
  let actionName = typeof operation === "string" ? operation : "labels_changed";
  if (typeof operation !== "string") {
    const [destination, conflictingDestination] = [
      { destination: "trash", labelId: MAILBOX_LABELS.trash },
      { destination: "spam", labelId: MAILBOX_LABELS.spam },
      { destination: "inbox", labelId: MAILBOX_LABELS.inbox },
    ].filter(
      ({ labelId }) => operation.addLabelIds?.includes(labelId) === true
    );
    if (destination !== undefined && conflictingDestination === undefined) {
      actionName = `move:${destination.destination}`;
    }
  }
  if (actionName === "move:spam") {
    return;
  }
  const action = {
    action: actionName,
    mailboxId: input.mailboxId,
    messageIds,
    metadata: {
      ...(typeof operation === "string"
        ? {}
        : {
            addedLabelIds: (operation.addLabelIds ?? []).join(","),
            removedLabelIds: (operation.removeLabelIds ?? []).join(","),
          }),
      ...labelFeedback,
    },
    targetCount: messageIds.length,
    userId: context.userId,
  };
  if (accessToken) {
    await learnAiMemoryFromGmailAction({ ...action, accessToken });
  } else {
    const { queueMailboxMessageMemory } = await import("../ai-memory-capture");
    await queueMailboxMessageMemory({
      mailboxId: input.mailboxId,
      messageIds,
      userId: context.userId,
    });
    await learnAiMemoryFromMailAction(action);
  }
};

const mutateMessage = async (
  { context, input }: MessageMutationArgs,
  operation: MetadataOperation
) => {
  const selectedMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const supersedesPlacement =
    operation === "trash" ||
    operation === "untrash" ||
    (typeof operation === "object" &&
      [
        ...(operation.addLabelIds ?? []),
        ...(operation.removeLabelIds ?? []),
      ].some((label) => ["INBOX", "SPAM", "TRASH"].includes(label)));
  const reopensInbox =
    operation === "untrash" ||
    (typeof operation === "object" &&
      operation.addLabelIds?.includes("INBOX") === true);
  if (supersedesPlacement) {
    await supersedePendingMailPlacement({
      context,
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      retireSnoozes: false,
    });
  }
  if (selectedMailbox.provider === "managed") {
    const authorizedInput = { ...input, userId: context.userId };
    if (operation === "read" || operation === "unread") {
      const result = await setManagedMessageReadState({
        ...authorizedInput,
        read: operation === "read",
      });
      if (!result.labelIds.includes(MAILBOX_LABELS.spam)) {
        await recordMetadataAction({ context, input }, operation, [result.id]);
      }
      return result;
    }
    if (operation === "trash" || operation === "untrash") {
      const result = await setManagedMessageMailboxState({
        ...authorizedInput,
        state: operation === "trash" ? "trash" : "active",
      });
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        matchHiddenMessageIdsOnly: !reopensInbox,
        messageId: input.messageId,
        retireSnoozes: true,
      });
      await recordMetadataAction({ context, input }, operation, [result.id]);
      return result;
    }
    const result = await updateSingleManagedMessageLabels({
      ...authorizedInput,
      ...operation,
    });
    if (supersedesPlacement) {
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        matchHiddenMessageIdsOnly: !reopensInbox,
        messageId: input.messageId,
        retireSnoozes: true,
      });
    }
    if (result.labelIds.includes(MAILBOX_LABELS.spam)) {
      return result;
    }
    const labelFeedback = await recordLabelFeedback({
      ...operation,
      mailboxId: input.mailboxId,
      providerMessageIds: [result.id],
      userId: context.userId,
    });
    await recordMetadataAction({ context, input, labelFeedback }, operation, [
      result.id,
    ]);
    return result;
  }
  return await callGmail(context, input.mailboxId, async (accessToken) => {
    let change: GmailMetadataChange;
    if (operation === "read") {
      change = { removeLabelIds: ["UNREAD"] };
    } else if (operation === "unread") {
      change = { addLabelIds: ["UNREAD"] };
    } else {
      change = operation;
    }
    const result = await mutateGmailMessage(
      accessToken,
      input.messageId,
      change
    );
    if (supersedesPlacement) {
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        matchHiddenMessageIdsOnly: !reopensInbox,
        messageId: result.id,
        retireSnoozes: true,
      });
    }
    await refreshGmailCapturedMessageMetadata({
      accessToken,
      mailboxId: input.mailboxId,
      messageIds: [result.id],
    });
    const memoryMessageIds = result.labelIds.includes(MAILBOX_LABELS.spam)
      ? []
      : [result.id];
    const labelFeedback =
      typeof operation === "string"
        ? undefined
        : await recordLabelFeedback({
            ...operation,
            mailboxId: input.mailboxId,
            providerMessageIds: memoryMessageIds,
            userId: context.userId,
          });
    await recordMetadataAction(
      { accessToken, context, input, labelFeedback },
      operation,
      memoryMessageIds
    );
    return result;
  });
};

type ThreadMutationArgs = {
  context: MailRequestContext;
  input: { mailboxId: string; threadId: string };
};

const mutateThread = async (
  { context, input }: ThreadMutationArgs,
  operation: MetadataOperation
) => {
  const selectedMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: context.userId,
  });
  const supersedesPlacement =
    operation === "trash" ||
    operation === "untrash" ||
    (typeof operation === "object" &&
      [
        ...(operation.addLabelIds ?? []),
        ...(operation.removeLabelIds ?? []),
      ].some((label) => ["INBOX", "SPAM", "TRASH"].includes(label)));
  if (supersedesPlacement) {
    await supersedePendingMailPlacement({
      context,
      mailboxId: input.mailboxId,
      retireSnoozes: false,
      threadIds: [input.threadId],
    });
  }
  if (selectedMailbox.provider === "managed") {
    const authorizedInput = { ...input, userId: context.userId };
    if (operation === "read" || operation === "unread") {
      const result = await setManagedThreadReadState({
        ...authorizedInput,
        read: operation === "read",
      });
      await recordMetadataAction(
        { context, input },
        operation,
        result.messages
          .filter((message) => !message.labelIds.includes(MAILBOX_LABELS.spam))
          .map((message) => message.id)
      );
      return result;
    }
    if (operation === "trash" || operation === "untrash") {
      const result = await setManagedThreadMailboxState({
        ...authorizedInput,
        state: operation === "trash" ? "trash" : "active",
      });
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        retireSnoozes: true,
        threadIds: [input.threadId],
      });
      await recordMetadataAction(
        { context, input },
        operation,
        result.messages.map((message) => message.id)
      );
      return result;
    }
    const result = await updateManagedThreadLabels({
      ...authorizedInput,
      ...operation,
    });
    if (supersedesPlacement) {
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        retireSnoozes: true,
        threadIds: [input.threadId],
      });
    }
    const memoryMessageIds = result.messages
      .filter((message) => !message.labelIds.includes(MAILBOX_LABELS.spam))
      .map((message) => message.id);
    const labelFeedback = await recordLabelFeedback({
      ...operation,
      mailboxId: input.mailboxId,
      providerMessageIds: memoryMessageIds,
      userId: context.userId,
    });
    await recordMetadataAction(
      { context, input, labelFeedback },
      operation,
      memoryMessageIds
    );
    return result;
  }
  return await callGmail(context, input.mailboxId, async (accessToken) => {
    let change: GmailMetadataChange;
    if (operation === "read") {
      change = { removeLabelIds: ["UNREAD"] };
    } else if (operation === "unread") {
      change = { addLabelIds: ["UNREAD"] };
    } else {
      change = operation;
    }
    const result = await mutateGmailThread(accessToken, input.threadId, change);
    if (supersedesPlacement) {
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        retireSnoozes: true,
        threadIds: [input.threadId],
      });
    }
    await refreshGmailCapturedMessageMetadata({
      accessToken,
      mailboxId: input.mailboxId,
      messageIds: result.messages.map((message) => message.id),
    });
    const memoryMessageIds = result.messages
      .filter((message) => !message.labelIds.includes(MAILBOX_LABELS.spam))
      .map((message) => message.id);
    const labelFeedback =
      typeof operation === "string"
        ? undefined
        : await recordLabelFeedback({
            ...operation,
            mailboxId: input.mailboxId,
            providerMessageIds: memoryMessageIds,
            userId: context.userId,
          });
    await recordMetadataAction(
      { accessToken, context, input, labelFeedback },
      operation,
      memoryMessageIds
    );
    return result;
  });
};

const applyMailChanges = async ({
  context,
  input,
  markDispatched,
  selectedMailbox,
}: {
  context: MailRequestContext;
  input: MailInputs["applyChanges"];
  markDispatched?: () => void;
  selectedMailbox: Awaited<ReturnType<typeof assertAccessibleMailbox>>;
}): Promise<MailMutationResult> => {
  const dispatch = async <T>(write: () => Promise<T>): Promise<T> => {
    try {
      const result = await write();
      markDispatched?.();
      return result;
    } catch (error) {
      const preconditionFailed =
        error instanceof ORPCError &&
        [400, 401, 403, 404, 409, 429].includes(error.status);
      if (!preconditionFailed && !isRejectedGmailWrite(error)) {
        markDispatched?.();
      }
      throw error;
    }
  };
  const afterWrite = async (work: () => Promise<void>) => {
    if (markDispatched === undefined) {
      await work();
      return;
    }
    await work().catch((error: unknown) => {
      reportError(error, { operation: "mail-command-metadata" });
    });
  };
  if (input.command.kind === "set-placement") {
    const { command } = input;
    return await dispatch(
      async () =>
        await applyMailPlacement({ context, input: { ...input, command } })
    );
  }
  const supersedesPlacement =
    input.command.kind === "move" ||
    (input.command.kind === "set-labels" &&
      [...input.command.addIds, ...input.command.removeIds].some((label) =>
        ["INBOX", "SPAM", "TRASH"].includes(label)
      ));
  if (supersedesPlacement) {
    await supersedePendingMailPlacement({
      context,
      mailboxId: input.mailboxId,
      retireSnoozes: false,
      threadIds: input.targets.map((target) => target.threadId),
    });
  }
  if (input.command.kind === "set-importance") {
    let { targets } = input;
    if (selectedMailbox.provider === "gmail") {
      targets = await callGmail(
        context,
        input.mailboxId,
        async (accessToken, signal) => {
          const threadIds = [
            ...new Set(input.targets.map((target) => target.threadId)),
          ];
          const incomingIdsByThread = new Map<string, string[]>();
          for (let offset = 0; offset < threadIds.length; offset += 4) {
            await Promise.all(
              threadIds.slice(offset, offset + 4).map(async (threadId) => {
                const thread = await getThreadWithDetails(
                  accessToken,
                  threadId,
                  signal,
                  async (snapshot) => {
                    await writeGmailCapturedMessage({
                      mailboxId: input.mailboxId,
                      snapshot,
                      source: "on_demand",
                    });
                  }
                );
                incomingIdsByThread.set(
                  threadId,
                  thread.messages
                    .filter(
                      (message) =>
                        message.labelIds?.some((label) =>
                          ["SENT", "DRAFT"].includes(label)
                        ) !== true
                    )
                    .map((message) => message.id)
                );
              })
            );
          }
          return input.targets.map((target) => {
            if (target.messageIds.length > 0) {
              return target;
            }
            const messageIds = incomingIdsByThread.get(target.threadId) ?? [];
            if (messageIds.length === 0) {
              throw new ORPCError("BAD_REQUEST", {
                message: "This thread has no incoming messages to update.",
              });
            }
            return { ...target, messageIds };
          });
        }
      ).catch((error: unknown) => {
        if (isGmailServiceError(error) && error.status === 404) {
          throw new ORPCError("NOT_FOUND", {
            message: "Message thread not found.",
          });
        }
        throw error;
      });
    }
    const { important } = input.command;
    return await dispatch(
      async () =>
        await setMailImportance({
          actorUserId: context.userId,
          important,
          mailboxId: input.mailboxId,
          targets,
        })
    );
  }
  if (selectedMailbox.provider === "managed") {
    const { command } = input;
    const result = await dispatch(
      async () =>
        await applyManagedMessageChanges({
          ...input,
          command,
          userId: context.userId,
        })
    );
    const appliedThreadIds = [
      ...new Set(
        input.targets.flatMap((target, index) =>
          result.targets[index]?.status === "applied" ? [target.threadId] : []
        )
      ),
    ];
    await afterWrite(async () => {
      if (supersedesPlacement && appliedThreadIds.length > 0) {
        await supersedePendingMailPlacement({
          context,
          mailboxId: input.mailboxId,
          retireSnoozes: true,
          threadIds: appliedThreadIds,
        });
      }
      const messageIds = [
        ...new Set(
          input.targets.flatMap((target, index) =>
            result.targets[index]?.status === "applied" ? target.messageIds : []
          )
        ),
      ];
      if (input.command.kind === "set-labels") {
        const labelFeedback = await recordLabelFeedback({
          addLabelIds: input.command.addIds,
          mailboxId: input.mailboxId,
          providerMessageIds: messageIds,
          removeLabelIds: input.command.removeIds,
          userId: context.userId,
        });
        await recordMetadataAction(
          { context, input, labelFeedback },
          {
            addLabelIds: input.command.addIds,
            removeLabelIds: input.command.removeIds,
          },
          messageIds
        );
      } else if (input.command.kind === "set-read") {
        await recordMetadataAction(
          { context, input },
          input.command.read ? "read" : "unread",
          messageIds
        );
      } else if (input.command.kind === "move" && messageIds.length > 0) {
        await recordMetadataAction(
          { context, input },
          `move:${input.command.destination}`,
          messageIds
        );
      }
    });
    return {
      syncToken: result.revision === null ? undefined : String(result.revision),
      targets: result.targets,
    };
  }

  return await callGmail(
    context,
    input.mailboxId,
    async (accessToken, signal) => {
      const requestedMessageIds = [
        ...new Set(input.targets.flatMap((target) => target.messageIds)),
      ];
      const associations = await getGmailMessageThreadAssociations(
        accessToken,
        requestedMessageIds,
        signal
      );
      const associationByMessageId = new Map(
        associations.map((association) => [association.id, association])
      );
      const validTargets = input.targets.filter((target) =>
        target.messageIds.every(
          (messageId) =>
            associationByMessageId.get(messageId)?.threadId === target.threadId
        )
      );
      const messageIds = [
        ...new Set(validTargets.flatMap((target) => target.messageIds)),
      ];
      const outcomes = new Map<string, "failed" | "uncertain">();
      const validTargetSet = new Set(validTargets);
      const targetResults = () =>
        input.targets.map((target): MailMutationResult["targets"][number] => {
          const appliedMessageIds: string[] = [];
          const failedMessageIds: string[] = [];
          const uncertainMessageIds: string[] = [];
          for (const id of new Set(target.messageIds)) {
            const outcome = validTargetSet.has(target)
              ? outcomes.get(id)
              : "failed";
            if (outcome === "uncertain") {
              uncertainMessageIds.push(id);
            } else if (outcome === "failed") {
              failedMessageIds.push(id);
            } else {
              appliedMessageIds.push(id);
            }
          }
          return {
            ...(markDispatched === undefined
              ? {}
              : { appliedMessageIds, failedMessageIds, uncertainMessageIds }),
            status:
              failedMessageIds.length + uncertainMessageIds.length === 0
                ? "applied"
                : "failed",
            threadId: target.threadId,
          };
        });
      if (messageIds.length === 0) {
        return { targets: targetResults() };
      }
      const { command } = input;
      if (command.kind === "delete-permanently") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Permanent bulk deletion is unavailable.",
        });
      }
      signal?.throwIfAborted();
      if (command.kind === "set-read") {
        await dispatch(
          async () =>
            await batchModifyMessages(
              accessToken,
              messageIds,
              command.read
                ? { removeLabelIds: ["UNREAD"] }
                : { addLabelIds: ["UNREAD"] },
              signal
            )
        );
        await afterWrite(async () => {
          await refreshGmailCapturedMessageMetadata({
            accessToken,
            mailboxId: input.mailboxId,
            messageIds,
          });
          await recordMetadataAction(
            { accessToken, context, input },
            command.read ? "read" : "unread",
            messageIds
          );
        });
      } else if (command.kind === "set-labels") {
        const { addIds, removeIds } = command;
        await dispatch(
          async () =>
            await batchModifyMessages(
              accessToken,
              messageIds,
              { addLabelIds: addIds, removeLabelIds: removeIds },
              signal
            )
        );
        await afterWrite(async () => {
          if (supersedesPlacement) {
            await supersedePendingMailPlacement({
              context,
              mailboxId: input.mailboxId,
              retireSnoozes: true,
              threadIds: validTargets.map((target) => target.threadId),
            });
          }
          await refreshGmailCapturedMessageMetadata({
            accessToken,
            mailboxId: input.mailboxId,
            messageIds,
          });
          const memoryMessageIds = addIds.includes(MAILBOX_LABELS.spam)
            ? []
            : messageIds.filter(
                (id) =>
                  removeIds.includes(MAILBOX_LABELS.spam) ||
                  associationByMessageId
                    .get(id)
                    ?.labelIds?.includes(MAILBOX_LABELS.spam) !== true
              );
          const labelFeedback = await recordLabelFeedback({
            addLabelIds: addIds,
            mailboxId: input.mailboxId,
            providerMessageIds: memoryMessageIds,
            removeLabelIds: removeIds,
            userId: context.userId,
          });
          await recordMetadataAction(
            { accessToken, context, input, labelFeedback },
            { addLabelIds: addIds, removeLabelIds: removeIds },
            memoryMessageIds
          );
        });
      } else if (command.kind === "move") {
        let failedMutation: PromiseRejectedResult | undefined;
        if (command.destination === "spam") {
          await dispatch(
            async () =>
              await batchModifyMessages(
                accessToken,
                messageIds,
                { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
                signal
              )
          );
        } else {
          const change = command.destination === "trash" ? "trash" : "untrash";
          const results = await Promise.allSettled(
            messageIds.map(
              async (id) =>
                await mutateGmailMessage(accessToken, id, change, signal)
            )
          );
          const [first] = results;
          if (first?.status === "rejected") {
            const failure: unknown = first.reason;
            if (
              isGmailServiceError(failure) &&
              [401, 403, 429].includes(failure.status) &&
              results.every(
                (result) =>
                  result.status === "rejected" &&
                  isGmailServiceError(result.reason) &&
                  result.reason.status === failure.status
              )
            ) {
              throw failure;
            }
          }
          const changedMessageIds: string[] = [];
          const alreadyInInbox = new Set<string>();
          for (const [index, id] of messageIds.entries()) {
            const result = results[index];
            if (result?.status === "fulfilled") {
              changedMessageIds.push(id);
              if (
                result.value.labelIds.includes("INBOX") &&
                !result.value.labelIds.some((label) =>
                  ["SPAM", "TRASH"].includes(label)
                )
              ) {
                alreadyInInbox.add(id);
              }
            } else if (result?.status === "rejected") {
              const error: unknown = result.reason;
              const rejected = isRejectedGmailWrite(error);
              outcomes.set(id, rejected ? "failed" : "uncertain");
              if (!rejected) {
                markDispatched?.();
                reportError(error, { operation: "mail-command-gmail-move" });
              }
              failedMutation ??= result;
            }
          }
          if (changedMessageIds.length > 0) {
            markDispatched?.();
            if (command.destination === "inbox") {
              try {
                await batchModifyMessages(
                  accessToken,
                  changedMessageIds,
                  { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
                  signal
                );
              } catch (error) {
                const rejected = isRejectedGmailWrite(error);
                const incompleteMessageIds = changedMessageIds.filter(
                  (id) => !alreadyInInbox.has(id)
                );
                for (const id of incompleteMessageIds) {
                  outcomes.set(id, rejected ? "failed" : "uncertain");
                }
                await afterWrite(async () => {
                  const untrashedMessageIds =
                    markDispatched === undefined
                      ? changedMessageIds
                      : incompleteMessageIds;
                  await refreshGmailCapturedMessageMetadata({
                    accessToken,
                    mailboxId: input.mailboxId,
                    messageIds: untrashedMessageIds,
                  });
                  await recordMetadataAction(
                    { accessToken, context, input },
                    "untrash",
                    untrashedMessageIds
                  );
                });
                if (markDispatched === undefined) {
                  throw error;
                }
                if (!rejected) {
                  reportError(error, { operation: "mail-command-gmail-inbox" });
                }
              }
            }
          }
        }
        const appliedMessageIds = messageIds.filter((id) => !outcomes.has(id));
        if (appliedMessageIds.length > 0) {
          const appliedThreadIds = [
            ...new Set(
              appliedMessageIds.flatMap((id) => {
                const threadId = associationByMessageId.get(id)?.threadId;
                return threadId === undefined ? [] : [threadId];
              })
            ),
          ];
          await afterWrite(async () => {
            await supersedePendingMailPlacement({
              context,
              mailboxId: input.mailboxId,
              retireSnoozes: true,
              threadIds: appliedThreadIds,
            });
            await refreshGmailCapturedMessageMetadata({
              accessToken,
              mailboxId: input.mailboxId,
              messageIds: appliedMessageIds,
            });
            await recordMetadataAction(
              { accessToken, context, input },
              `move:${command.destination}`,
              appliedMessageIds
            );
          });
        }
        if (markDispatched === undefined && failedMutation) {
          throw failedMutation.reason;
        }
      }
      return { targets: targetResults() };
    }
  );
};

export const mutationsMailOperations = {
  applyChanges: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["applyChanges"];
  }): Promise<MailMutationResult> => {
    if (input.requestId === undefined) {
      const selectedMailbox = await assertAccessibleMailbox({
        mailboxId: input.mailboxId,
        userId: context.userId,
      });
      return await applyMailChanges({ context, input, selectedMailbox });
    }
    const selectedMailbox = await authorizeMailPlacement(
      context,
      input.mailboxId
    );
    if (input.command.kind === "delete-permanently") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Permanent bulk deletion is unavailable.",
      });
    }
    return await executeMailCommandWithReceipt({
      actorUserId: context.userId,
      execute: async (markDispatched) =>
        await applyMailChanges({
          context,
          input,
          markDispatched,
          selectedMailbox,
        }),
      input,
      requestId: input.requestId,
      wake:
        selectedMailbox.provider === "gmail" &&
        serverEnv.QUIETER_GMAIL_EVENTS_ENABLED === true &&
        input.command.kind !== "set-placement" &&
        input.command.kind !== "set-importance"
          ? async () => {
              const publication = publishMailUpdate({
                mailboxId: input.mailboxId,
                type: "mailbox.changed",
              });
              if (context.scheduleBackgroundTask) {
                context.scheduleBackgroundTask(publication);
              } else {
                await publication;
              }
            }
          : undefined,
    });
  },
  markMessageAsRead: async (args: MessageMutationArgs) =>
    await mutateMessage(args, "read"),
  markMessageAsUnread: async (args: MessageMutationArgs) =>
    await mutateMessage(args, "unread"),
  markThreadAsRead: async (args: ThreadMutationArgs) =>
    await mutateThread(args, "read"),
  markThreadAsUnread: async (args: ThreadMutationArgs) =>
    await mutateThread(args, "unread"),
  moveMessageToTrash: async (args: MessageMutationArgs) =>
    await mutateMessage(args, "trash"),
  moveThreadToTrash: async (args: ThreadMutationArgs) =>
    await mutateThread(args, "trash"),
  untrashMessage: async (args: MessageMutationArgs) =>
    await mutateMessage(args, "untrash"),
  untrashThread: async (args: ThreadMutationArgs) =>
    await mutateThread(args, "untrash"),
  updateMessageLabels: async (args: {
    context: MailRequestContext;
    input: MailInputs["updateMessageLabels"];
  }) =>
    await mutateMessage(args, {
      addLabelIds: args.input.addLabelIds,
      removeLabelIds: args.input.removeLabelIds,
    }),
  updateThreadLabels: async (args: {
    context: MailRequestContext;
    input: MailInputs["updateThreadLabels"];
  }) =>
    await mutateThread(args, {
      addLabelIds: args.input.addLabelIds,
      removeLabelIds: args.input.removeLabelIds,
    }),
};
