import { ORPCError } from "@orpc/server";
import type {
  MailCommandFollowUp,
  MailCommandSnoozeVersion,
} from "@quieter/database/schema";
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
import type { MailCommandExecution } from "./command-receipt";
import {
  learnAiMemoryFromGmailAction,
  learnAiMemoryFromMailAction,
  recordLabelFeedback,
} from "./feedback";
import type { MailInputs } from "./inputs";
import {
  applyMailPlacement,
  readMailCommandSnoozes,
  supersedePendingMailPlacement,
} from "./placement";
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

const finishMailCommand = async (
  work: MailCommandFollowUp,
  execution: MailCommandExecution,
  context: MailRequestContext,
  mailboxId: string,
  gmail?: { accessToken: string; signal?: AbortSignal; resume?: true }
): Promise<MailMutationResult> => {
  const retire = async (snoozes: MailCommandSnoozeVersion[]) => {
    if (snoozes.length > 0) {
      await supersedePendingMailPlacement({
        context,
        mailboxId,
        snoozes,
        threadIds: snoozes.map(({ threadId }) => threadId),
      });
    }
  };
  if (work.kind !== "restore-inbox") {
    await retire(work.snoozes);
    return work.result;
  }
  const collectAppliedSnoozes = (result: MailMutationResult) => {
    const threads = new Set(
      result.targets.flatMap((target) =>
        (target.appliedMessageIds?.length ?? 0) +
          (target.untrashedMessageIds?.length ?? 0) >
        0
          ? [target.threadId]
          : []
      )
    );
    return work.snoozes.filter(({ threadId }) => threads.has(threadId));
  };
  await retire(collectAppliedSnoozes(work.result));
  const restore = async (accessToken: string, signal?: AbortSignal) => {
    const restored = new Set<string>();
    let remaining = work.messages.map(({ id }) => id);
    if (gmail === undefined || gmail.resume === true) {
      const messages = await getGmailMessageThreadAssociations(
        accessToken,
        remaining,
        signal
      );
      const labelsById = new Map(
        messages.map(({ id, labelIds }) => [id, labelIds ?? []])
      );
      remaining = work.messages.flatMap(({ id, wasSpam }) => {
        const labels = labelsById.get(id);
        if (labels === undefined || labels.includes("TRASH")) {
          return [];
        }
        if (labels.includes("INBOX") && !labels.includes("SPAM")) {
          restored.add(id);
          return [];
        }
        return labels.includes("SPAM") === wasSpam ? [id] : [];
      });
    }
    if (remaining.length > 0) {
      signal?.throwIfAborted();
      await execution.dispatch(
        async () =>
          await batchModifyMessages(
            accessToken,
            remaining,
            { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
            signal
          )
      );
      for (const id of remaining) {
        restored.add(id);
      }
    }
    const validTargetIndexes = new Set(work.validTargetIndexes);
    const result = {
      ...work.result,
      targets: work.result.targets.map(
        (target, index): MailMutationResult["targets"][number] => {
          if (!validTargetIndexes.has(index)) {
            return target;
          }
          const restoredIds =
            target.failedMessageIds?.filter((id) => restored.has(id)) ?? [];
          const failedMessageIds =
            target.failedMessageIds?.filter((id) => !restored.has(id)) ?? [];
          return {
            ...target,
            appliedMessageIds: [
              ...(target.appliedMessageIds ?? []),
              ...restoredIds,
            ],
            failedMessageIds,
            status:
              failedMessageIds.length +
                (target.uncertainMessageIds?.length ?? 0) ===
              0
                ? "applied"
                : "failed",
            untrashedMessageIds: target.untrashedMessageIds?.filter(
              (id) => !restored.has(id)
            ),
          };
        }
      ),
    };
    const snoozes = collectAppliedSnoozes(result);
    if (snoozes.length > 0) {
      await execution.saveFollowUp({ kind: "retire-snoozes", result, snoozes });
      await retire(snoozes);
    }
    return result;
  };
  return gmail === undefined
    ? await callGmail(context, mailboxId, restore)
    : await restore(gmail.accessToken, gmail.signal);
};

const applyMailChanges = async ({
  context,
  execution,
  input,
  selectedMailbox,
}: {
  context: MailRequestContext;
  execution?: MailCommandExecution;
  input: MailInputs["applyChanges"];
  selectedMailbox: Awaited<ReturnType<typeof assertAccessibleMailbox>>;
}): Promise<MailMutationResult> => {
  if (execution?.followUp !== undefined) {
    return await finishMailCommand(
      execution.followUp,
      execution,
      context,
      input.mailboxId
    );
  }
  const dispatch = async <T>(write: () => Promise<T>): Promise<T> =>
    await (execution === undefined ? write() : execution.dispatch(write));
  const afterWrite = async (work: () => Promise<void>) => {
    if (execution === undefined) {
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
  const targetedThreadIds = input.targets.map(({ threadId }) => threadId);
  const snoozes =
    supersedesPlacement && execution !== undefined
      ? await readMailCommandSnoozes(input.mailboxId, targetedThreadIds)
      : [];
  const supersedeBeforeWrite = async (threadIds: string[]) => {
    if (supersedesPlacement) {
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        retireSnoozes: false,
        threadIds,
      });
    }
  };
  const finishSnoozes = async (
    result: MailMutationResult,
    affectedThreadIds: string[]
  ) => {
    if (affectedThreadIds.length === 0) {
      return;
    }
    if (execution === undefined) {
      await supersedePendingMailPlacement({
        context,
        mailboxId: input.mailboxId,
        threadIds: affectedThreadIds,
      });
      return;
    }
    const affected = new Set(affectedThreadIds);
    const work: MailCommandFollowUp = {
      kind: "retire-snoozes",
      result,
      snoozes: snoozes.filter(({ threadId }) => affected.has(threadId)),
    };
    if (work.snoozes.length > 0) {
      await execution.saveFollowUp(work);
      await finishMailCommand(work, execution, context, input.mailboxId);
    }
  };
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
    const result = await dispatch(async () => {
      await supersedeBeforeWrite(targetedThreadIds);
      return await applyManagedMessageChanges({
        ...input,
        command,
        userId: context.userId,
      });
    });
    const appliedThreadIds = [
      ...new Set(
        input.targets.flatMap((target, index) =>
          result.targets[index]?.status === "applied" ? [target.threadId] : []
        )
      ),
    ];
    const outcome = {
      syncToken: result.revision === null ? undefined : String(result.revision),
      targets: result.targets,
    };
    if (supersedesPlacement) {
      await finishSnoozes(outcome, appliedThreadIds);
    }
    await afterWrite(async () => {
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
    return outcome;
  }

  return await callGmail(
    context,
    input.mailboxId,
    async (accessToken, signal) => {
      if (execution?.followUp !== undefined) {
        return await finishMailCommand(
          execution.followUp,
          execution,
          context,
          input.mailboxId,
          { accessToken, resume: true, signal }
        );
      }
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
      const validThreadIds = validTargets.flatMap((target) =>
        target.messageIds.length > 0 ? [target.threadId] : []
      );
      const outcomes = new Map<string, "failed" | "uncertain" | "restoring">();
      const untrashed = new Set<string>();
      const validTargetSet = new Set(validTargets);
      const targetResults = () =>
        input.targets.map((target): MailMutationResult["targets"][number] => {
          const appliedMessageIds: string[] = [];
          const failedMessageIds: string[] = [];
          const uncertainMessageIds: string[] = [];
          const untrashedMessageIds: string[] = [];
          for (const id of new Set(target.messageIds)) {
            const outcome = validTargetSet.has(target)
              ? outcomes.get(id)
              : "failed";
            if (outcome === "uncertain") {
              uncertainMessageIds.push(id);
            } else if (outcome === "failed" || outcome === "restoring") {
              failedMessageIds.push(id);
              if (outcome === "restoring" && untrashed.has(id)) {
                untrashedMessageIds.push(id);
              }
            } else {
              appliedMessageIds.push(id);
            }
          }
          return {
            ...(execution === undefined
              ? {}
              : { appliedMessageIds, failedMessageIds, uncertainMessageIds }),
            ...(untrashedMessageIds.length === 0
              ? {}
              : { untrashedMessageIds }),
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
        await dispatch(async () => {
          await supersedeBeforeWrite(validThreadIds);
          await batchModifyMessages(
            accessToken,
            messageIds,
            { addLabelIds: addIds, removeLabelIds: removeIds },
            signal
          );
        });
        if (supersedesPlacement) {
          await finishSnoozes({ targets: targetResults() }, validThreadIds);
        }
        await afterWrite(async () => {
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
        const restoring: Extract<
          MailCommandFollowUp,
          { kind: "restore-inbox" }
        >["messages"] = [];
        if (command.destination === "spam") {
          await dispatch(async () => {
            await supersedeBeforeWrite(validThreadIds);
            await batchModifyMessages(
              accessToken,
              messageIds,
              { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
              signal
            );
          });
        } else {
          const change = command.destination === "trash" ? "trash" : "untrash";
          const results = await dispatch(async () => {
            await supersedeBeforeWrite(validThreadIds);
            const settled = await Promise.allSettled(
              messageIds.map(
                async (id) =>
                  await mutateGmailMessage(accessToken, id, change, signal)
              )
            );
            const [first] = settled;
            if (first?.status === "rejected") {
              const error: unknown = first.reason;
              if (
                isGmailServiceError(error) &&
                [401, 403, 429].includes(error.status) &&
                settled.every(
                  (result) =>
                    result.status === "rejected" &&
                    isGmailServiceError(result.reason) &&
                    result.reason.status === error.status
                )
              ) {
                throw error;
              }
            }
            return settled;
          });
          const changedMessageIds: string[] = [];
          for (const [index, id] of messageIds.entries()) {
            const result = results[index];
            if (result?.status === "fulfilled") {
              const { labelIds } = result.value;
              if (
                execution !== undefined &&
                command.destination === "inbox" &&
                labelIds.includes("TRASH")
              ) {
                outcomes.set(id, "failed");
                continue;
              }
              changedMessageIds.push(id);
              const inInbox =
                labelIds.includes("INBOX") && !labelIds.includes("SPAM");
              if (
                execution !== undefined &&
                command.destination === "inbox" &&
                !inInbox
              ) {
                restoring.push({ id, wasSpam: labelIds.includes("SPAM") });
                outcomes.set(id, "restoring");
                if (
                  associationByMessageId
                    .get(id)
                    ?.labelIds?.includes("TRASH") === true
                ) {
                  untrashed.add(id);
                }
              }
            } else if (result?.status === "rejected") {
              const error: unknown = result.reason;
              const rejected = isRejectedGmailWrite(error);
              outcomes.set(id, rejected ? "failed" : "uncertain");
              if (!rejected) {
                reportError(error, { operation: "mail-command-gmail-move" });
              }
              failedMutation ??= result;
            }
          }
          if (
            execution === undefined &&
            command.destination === "inbox" &&
            changedMessageIds.length > 0
          ) {
            try {
              await batchModifyMessages(
                accessToken,
                changedMessageIds,
                { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
                signal
              );
            } catch (error) {
              await refreshGmailCapturedMessageMetadata({
                accessToken,
                mailboxId: input.mailboxId,
                messageIds: changedMessageIds,
              });
              await recordMetadataAction(
                { accessToken, context, input },
                "untrash",
                changedMessageIds
              );
              throw error;
            }
          }
        }
        let result: MailMutationResult = { targets: targetResults() };
        if (execution !== undefined && restoring.length > 0) {
          const work: MailCommandFollowUp = {
            kind: "restore-inbox",
            messages: restoring,
            result,
            snoozes,
            validTargetIndexes: input.targets.flatMap((target, index) =>
              validTargetSet.has(target) ? [index] : []
            ),
          };
          await execution.saveFollowUp(work);
          result = await finishMailCommand(
            work,
            execution,
            context,
            input.mailboxId,
            { accessToken, signal }
          );
        } else {
          const appliedThreadIds = validTargets.flatMap((target) =>
            target.messageIds.some((id) => !outcomes.has(id))
              ? [target.threadId]
              : []
          );
          await finishSnoozes(result, appliedThreadIds);
        }
        const appliedMessageIds =
          execution === undefined
            ? messageIds.filter((id) => !outcomes.has(id))
            : [
                ...new Set(
                  result.targets.flatMap(
                    (target) => target.appliedMessageIds ?? []
                  )
                ),
              ];
        if (appliedMessageIds.length > 0) {
          await afterWrite(async () => {
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
        if (execution === undefined && failedMutation !== undefined) {
          throw failedMutation.reason;
        }
        return result;
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
      execute: async (execution) =>
        await applyMailChanges({
          context,
          execution,
          input,
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
