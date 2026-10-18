import { ORPCError } from "@orpc/server";
import type { GmailMetadataChange } from "@quieter/gmail";
import {
  batchModifyMessages,
  mutateGmailMessage,
  mutateGmailThread,
  getGmailMessageThreadAssociations,
} from "@quieter/gmail";

import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
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
  learnAiMemoryFromGmailAction,
  learnAiMemoryFromMailAction,
  recordLabelFeedback,
  recordGmailLabelFeedback,
} from "./feedback";
import type { GmailActionContext } from "./feedback";
import type { MailInputs } from "./inputs";

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
    gmailContext,
    input,
  }: {
    accessToken?: string;
    context: MailRequestContext;
    gmailContext?: GmailActionContext | null;
    input: { mailboxId: string };
  },
  operation: MetadataOperation,
  messageIds: string[]
) => {
  if (messageIds.length === 0) {
    return;
  }
  const action = {
    action: typeof operation === "string" ? operation : "labels_changed",
    mailboxId: input.mailboxId,
    messageIds,
    metadata: {
      ...(typeof operation === "string"
        ? {}
        : {
            addedLabelIds: (operation.addLabelIds ?? []).join(","),
            removedLabelIds: (operation.removeLabelIds ?? []).join(","),
          }),
      ...gmailContext,
    },
    targetCount: messageIds.length,
    userId: context.userId,
  };
  if (accessToken) {
    await learnAiMemoryFromGmailAction({ ...action, accessToken });
  } else {
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
  if (selectedMailbox.provider === "managed") {
    const authorizedInput = { ...input, userId: context.userId };
    if (operation === "read" || operation === "unread") {
      const result = await setManagedMessageReadState({
        ...authorizedInput,
        read: operation === "read",
      });
      await recordMetadataAction({ context, input }, operation, [result.id]);
      return result;
    }
    if (operation === "trash" || operation === "untrash") {
      const result = await setManagedMessageMailboxState({
        ...authorizedInput,
        state: operation === "trash" ? "trash" : "active",
      });
      await recordMetadataAction({ context, input }, operation, [result.id]);
      return result;
    }
    const result = await updateSingleManagedMessageLabels({
      ...authorizedInput,
      ...operation,
    });
    await recordLabelFeedback({
      ...operation,
      mailboxId: input.mailboxId,
      providerMessageIds: [result.id],
      userId: context.userId,
    });
    await recordMetadataAction({ context, input }, operation, [result.id]);
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
    let gmailContext: GmailActionContext | null | undefined;
    if (typeof operation !== "string") {
      gmailContext = await recordGmailLabelFeedback({
        accessToken,
        ...operation,
        mailboxId: input.mailboxId,
        providerMessageIds: [result.id],
        userId: context.userId,
      });
    }
    await recordMetadataAction(
      { accessToken, context, gmailContext, input },
      operation,
      [result.id]
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
        result.messages.map((message) => message.id)
      );
      return result;
    }
    if (operation === "trash" || operation === "untrash") {
      const result = await setManagedThreadMailboxState({
        ...authorizedInput,
        state: operation === "trash" ? "trash" : "active",
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
    await recordLabelFeedback({
      ...operation,
      mailboxId: input.mailboxId,
      providerMessageIds: result.messages.map((message) => message.id),
      userId: context.userId,
    });
    await recordMetadataAction(
      { context, input },
      operation,
      result.messages.map((message) => message.id)
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
    let gmailContext: GmailActionContext | null | undefined;
    if (typeof operation !== "string") {
      gmailContext = await recordGmailLabelFeedback({
        accessToken,
        ...operation,
        mailboxId: input.mailboxId,
        providerMessageIds: result.messages.map((message) => message.id),
        userId: context.userId,
      });
    }
    await recordMetadataAction(
      { accessToken, context, gmailContext, input },
      operation,
      result.messages.map((message) => message.id)
    );
    return result;
  });
};

export const mutationsMailOperations = {
  applyChanges: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["applyChanges"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      const result = await applyManagedMessageChanges({
        ...input,
        userId: context.userId,
      });
      const messageIds = [
        ...new Set(
          input.targets.flatMap((target, index) =>
            result.targets[index]?.status === "applied" ? target.messageIds : []
          )
        ),
      ];
      if (input.command.kind === "set-labels") {
        await recordLabelFeedback({
          addLabelIds: input.command.addIds,
          mailboxId: input.mailboxId,
          providerMessageIds: messageIds,
          removeLabelIds: input.command.removeIds,
          userId: context.userId,
        });
        await recordMetadataAction(
          { context, input },
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
        await learnAiMemoryFromMailAction({
          action: `move:${input.command.destination}`,
          mailboxId: input.mailboxId,
          messageIds,
          targetCount: messageIds.length,
          userId: context.userId,
        });
      }
      return {
        syncToken:
          result.revision === null ? undefined : String(result.revision),
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
        const threadIdByMessageId = new Map(
          associations.map((association) => [
            association.id,
            association.threadId,
          ])
        );
        const validTargets = input.targets.filter((target) =>
          target.messageIds.every(
            (messageId) =>
              threadIdByMessageId.get(messageId) === target.threadId
          )
        );
        const messageIds = [
          ...new Set(validTargets.flatMap((target) => target.messageIds)),
        ];
        const targetResults = input.targets.map((target) => ({
          status: validTargets.includes(target) ? "applied" : "failed",
          threadId: target.threadId,
        }));
        if (messageIds.length === 0) {
          return { targets: targetResults };
        }
        if (input.command.kind === "delete-permanently") {
          throw new ORPCError("BAD_REQUEST", {
            message: "Permanent bulk deletion is unavailable.",
          });
        }
        let appliedMessageIds = messageIds;
        let failedMutation: PromiseRejectedResult | undefined;
        if (input.command.kind === "set-read") {
          await batchModifyMessages(
            accessToken,
            messageIds,
            input.command.read
              ? { removeLabelIds: ["UNREAD"] }
              : { addLabelIds: ["UNREAD"] },
            signal
          );
          await recordMetadataAction(
            { accessToken, context, input },
            input.command.read ? "read" : "unread",
            messageIds
          );
        } else if (input.command.kind === "set-labels") {
          await batchModifyMessages(
            accessToken,
            messageIds,
            {
              addLabelIds: input.command.addIds,
              removeLabelIds: input.command.removeIds,
            },
            signal
          );
          const gmailContext = await recordGmailLabelFeedback({
            accessToken,
            addLabelIds: input.command.addIds,
            mailboxId: input.mailboxId,
            providerMessageIds: messageIds,
            removeLabelIds: input.command.removeIds,
            userId: context.userId,
          });
          await recordMetadataAction(
            { accessToken, context, gmailContext, input },
            {
              addLabelIds: input.command.addIds,
              removeLabelIds: input.command.removeIds,
            },
            messageIds
          );
        } else if (
          input.command.destination === "trash" ||
          input.command.destination === "inbox"
        ) {
          const change =
            input.command.destination === "trash" ? "trash" : "untrash";
          const results = await Promise.allSettled(
            messageIds.map(
              async (messageId) =>
                await mutateGmailMessage(accessToken, messageId, change, signal)
            )
          );
          appliedMessageIds = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value.id] : []
          );
          failedMutation = results.find(
            (result) => result.status === "rejected"
          );
          if (
            input.command.destination === "inbox" &&
            appliedMessageIds.length > 0
          ) {
            try {
              await batchModifyMessages(
                accessToken,
                appliedMessageIds,
                { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
                signal
              );
            } catch (error) {
              await recordMetadataAction(
                { accessToken, context, input },
                "untrash",
                appliedMessageIds
              );
              throw error;
            }
          }
        } else {
          await batchModifyMessages(
            accessToken,
            messageIds,
            input.command.destination === "archive"
              ? { removeLabelIds: ["INBOX"] }
              : { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
            signal
          );
        }
        if (input.command.kind === "move" && appliedMessageIds.length > 0) {
          await learnAiMemoryFromGmailAction({
            accessToken,
            action: `move:${input.command.destination}`,
            mailboxId: input.mailboxId,
            messageIds: appliedMessageIds,
            targetCount: appliedMessageIds.length,
            userId: context.userId,
          });
        }
        if (failedMutation) {
          throw failedMutation.reason;
        }
        return {
          targets: targetResults,
        };
      }
    );
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
