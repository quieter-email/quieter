import { ORPCError } from "@orpc/server";
import {
  batchModifyMessages,
  getGmailMessageThreadAssociations,
  markMessageAsRead,
  markMessageAsUnread,
  markThreadAsRead,
  markThreadAsUnread,
  moveMessageToTrash,
  moveThreadToTrash,
  untrashMessage,
  untrashThread,
  updateMessageLabels,
  updateThreadLabels,
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
                await moveMessageToTrash(accessToken, messageId, signal)
            )
          );
        } else if (input.command.destination === "inbox") {
          await Promise.all(
            messageIds.map(
              async (messageId) =>
                await untrashMessage(accessToken, messageId, signal)
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
  markMessageAsRead: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["markMessageAsRead"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedMessageReadState({
        ...input,
        read: true,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await markMessageAsRead(accessToken, input.messageId)
    );
  },
  markMessageAsUnread: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["markMessageAsUnread"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedMessageReadState({
        ...input,
        read: false,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await markMessageAsUnread(accessToken, input.messageId)
    );
  },
  markThreadAsRead: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["markThreadAsRead"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedThreadReadState({
        ...input,
        read: true,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) => await markThreadAsRead(accessToken, input.threadId)
    );
  },
  markThreadAsUnread: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["markThreadAsUnread"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedThreadReadState({
        ...input,
        read: false,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await markThreadAsUnread(accessToken, input.threadId)
    );
  },
  moveMessageToTrash: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["moveMessageToTrash"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedMessageMailboxState({
        ...input,
        state: "trash",
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await moveMessageToTrash(accessToken, input.messageId)
    );
  },
  moveThreadToTrash: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["moveThreadToTrash"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedThreadMailboxState({
        ...input,
        state: "trash",
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await moveThreadToTrash(accessToken, input.threadId)
    );
  },
  untrashMessage: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["untrashMessage"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedMessageMailboxState({
        ...input,
        state: "active",
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) => await untrashMessage(accessToken, input.messageId)
    );
  },
  untrashThread: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["untrashThread"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await setManagedThreadMailboxState({
        ...input,
        state: "active",
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) => await untrashThread(accessToken, input.threadId)
    );
  },
  updateMessageLabels: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["updateMessageLabels"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      const result = await updateSingleManagedMessageLabels({
        ...input,
        userId: context.userId,
      });
      await recordLabelFeedback({
        addLabelIds: input.addLabelIds,
        mailboxId: input.mailboxId,
        providerMessageIds: [result.id],
        removeLabelIds: input.removeLabelIds,
        userId: context.userId,
      });
      return result;
    }
    return await callGmail(context, input.mailboxId, async (accessToken) => {
      const result = await updateMessageLabels(accessToken, input.messageId, {
        addLabelIds: input.addLabelIds,
        removeLabelIds: input.removeLabelIds,
      });
      await recordGmailLabelFeedback({
        accessToken,
        addLabelIds: input.addLabelIds,
        mailboxId: input.mailboxId,
        providerMessageIds: [result.id],
        removeLabelIds: input.removeLabelIds,
        userId: context.userId,
      });
      return result;
    });
  },
  updateThreadLabels: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["updateThreadLabels"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      const result = await updateManagedThreadLabels({
        ...input,
        userId: context.userId,
      });
      await recordLabelFeedback({
        addLabelIds: input.addLabelIds,
        mailboxId: input.mailboxId,
        providerMessageIds: result.messages.map((message) => message.id),
        removeLabelIds: input.removeLabelIds,
        userId: context.userId,
      });
      return result;
    }
    return await callGmail(context, input.mailboxId, async (accessToken) => {
      const result = await updateThreadLabels(accessToken, input.threadId, {
        addLabelIds: input.addLabelIds,
        removeLabelIds: input.removeLabelIds,
      });
      await recordGmailLabelFeedback({
        accessToken,
        addLabelIds: input.addLabelIds,
        mailboxId: input.mailboxId,
        providerMessageIds: result.messages.map((message) => message.id),
        removeLabelIds: input.removeLabelIds,
        userId: context.userId,
      });
      return result;
    });
  },
};
