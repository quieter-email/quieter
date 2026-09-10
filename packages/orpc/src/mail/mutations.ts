import { ORPCError } from "@orpc/server";
import type { GmailMetadataChange } from "@quieter/gmail";
import {
  batchModifyMessages,
  mutateGmailMessage,
  mutateGmailThread,
  getGmailMessageThreadAssociations,
} from "@quieter/gmail";
import { reportError } from "@quieter/observability";

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
  learnAiMemoryFromMailAction,
  recordLabelFeedback,
  recordGmailLabelFeedback,
} from "./feedback";
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
      return await setManagedMessageReadState({
        ...authorizedInput,
        read: operation === "read",
      });
    }
    if (operation === "trash" || operation === "untrash") {
      return await setManagedMessageMailboxState({
        ...authorizedInput,
        state: operation === "trash" ? "trash" : "active",
      });
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
    if (typeof operation !== "string") {
      await recordGmailLabelFeedback({
        accessToken,
        ...operation,
        mailboxId: input.mailboxId,
        providerMessageIds: [result.id],
        userId: context.userId,
      });
    }
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
      return await setManagedThreadReadState({
        ...authorizedInput,
        read: operation === "read",
      });
    }
    if (operation === "trash" || operation === "untrash") {
      return await setManagedThreadMailboxState({
        ...authorizedInput,
        state: operation === "trash" ? "trash" : "active",
      });
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
    if (typeof operation !== "string") {
      await recordGmailLabelFeedback({
        accessToken,
        ...operation,
        mailboxId: input.mailboxId,
        providerMessageIds: result.messages.map((message) => message.id),
        userId: context.userId,
      });
    }
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
      if (input.command.kind === "move") {
        await learnAiMemoryFromMailAction({
          action: `move:${input.command.destination}`,
          mailboxId: input.mailboxId,
          targetCount: input.targets.length,
          userId: context.userId,
        }).catch((error: unknown) => {
          reportError(error, { operation: "Could not record mailbox action." });
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
        if (input.command.kind === "set-read") {
          await batchModifyMessages(
            accessToken,
            messageIds,
            input.command.read
              ? { removeLabelIds: ["UNREAD"] }
              : { addLabelIds: ["UNREAD"] },
            signal
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
        } else if (input.command.destination === "trash") {
          await Promise.all(
            messageIds.map(
              async (messageId) =>
                await mutateGmailMessage(
                  accessToken,
                  messageId,
                  "trash",
                  signal
                )
            )
          );
        } else if (input.command.destination === "inbox") {
          await Promise.all(
            messageIds.map(
              async (messageId) =>
                await mutateGmailMessage(
                  accessToken,
                  messageId,
                  "untrash",
                  signal
                )
            )
          );
          await batchModifyMessages(
            accessToken,
            messageIds,
            { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
            signal
          );
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
        if (input.command.kind === "move") {
          await learnAiMemoryFromMailAction({
            action: `move:${input.command.destination}`,
            mailboxId: input.mailboxId,
            targetCount: validTargets.length,
            userId: context.userId,
          }).catch((error: unknown) => {
            reportError(error, {
              operation: "Could not record mailbox action.",
            });
          });
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
