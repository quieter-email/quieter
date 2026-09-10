import { ORPCError } from "@orpc/server";
import {
  batchModifyMessages,
  mutateGmailMessage,
  getGmailMessageThreadAssociations,
} from "@quieter/gmail";
import { reportError } from "@quieter/observability";

import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { assertAccessibleMailbox } from "../mailbox/service";
import { applyManagedMessageChanges } from "../managed-mail/messages/service";
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
      if (input.command.kind === "set-labels") {
        const applied = new Set(
          result.targets
            .filter((target) => target.status === "applied")
            .map((target) => target.threadId)
        );
        await recordLabelFeedback({
          addLabelIds: input.command.addIds,
          mailboxId: input.mailboxId,
          providerMessageIds: input.targets
            .filter((target) => applied.has(target.threadId))
            .flatMap((target) => target.messageIds),
          removeLabelIds: input.command.removeIds,
          userId: context.userId,
        });
      }
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
        if (input.command.kind === "set-labels") {
          await recordGmailLabelFeedback({
            accessToken,
            addLabelIds: input.command.addIds,
            mailboxId: input.mailboxId,
            providerMessageIds: messageIds,
            removeLabelIds: input.command.removeIds,
            userId: context.userId,
          });
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
};
