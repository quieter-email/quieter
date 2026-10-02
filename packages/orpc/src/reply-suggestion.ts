import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { resolveBackgroundModel } from "@quieter/ai/model-config";
import { suggestReply } from "@quieter/ai/suggest-reply";
import type { ReplySuggestion } from "@quieter/ai/suggest-reply";
import { reportAiUsage } from "@quieter/billing";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";
import { compile } from "html-to-text";
import { z } from "zod";

import { assertCanUseAi } from "./ai-access";
import { loadAiAgentContext, serializeAiAgentContext } from "./ai-memory";
import type { MailRequestContext } from "./gmail-request";
import { queriesMailOperations } from "./mail/queries";
import { assertAccessibleMailbox } from "./mailbox/service";

export const replySuggestionInputSchema = z.strictObject({
  mailboxId: z.string().trim().min(1).max(500),
  messageId: z.string().trim().min(1).max(500),
  threadId: z.string().trim().min(1).max(500),
});

const htmlToText = compile({ wordwrap: false });

export const requestReplySuggestion = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof replySuggestionInputSchema>;
}): Promise<ReplySuggestion> => {
  let usageReport: Promise<void> | undefined;
  let generating = false;
  try {
    const mailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (!mailbox.capabilities.canSend) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have permission to reply from this mailbox.",
      });
    }
    await assertCanUseAi({
      organizationId: mailbox.organizationId,
      userId: context.userId,
    });
    const thread = await queriesMailOperations.getThread({
      context,
      input: { mailboxId: mailbox.id, threadId: input.threadId },
    });
    const target = thread.messages.find(
      (message) =>
        message.id === input.messageId && message.threadId === input.threadId
    );
    if (thread.threadId !== input.threadId || target === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Message not found." });
    }
    if (
      target.draftId ||
      target.labelIds?.includes(MAILBOX_LABELS.drafts) === true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose a received message to suggest a reply.",
      });
    }
    if (target.labelIds?.includes(MAILBOX_LABELS.sent) === true) {
      return {
        reason: "This message was sent from your mailbox.",
        status: "not_needed",
      };
    }
    const conversation = thread.messages
      .filter(
        (message) =>
          message.threadId === input.threadId &&
          !message.draftId &&
          message.labelIds?.includes(MAILBOX_LABELS.drafts) !== true
      )
      .toSorted(
        (left, right) =>
          Number(left.internalDate ?? 0) - Number(right.internalDate ?? 0)
      );
    const recentIds = new Set([
      ...conversation.slice(-11).map((message) => message.id),
      target.id,
    ]);
    const messages = conversation
      .filter((message) => recentIds.has(message.id))
      .map((message) => ({
        bodyText: (
          message.bodyText ||
          (message.bodyHtml
            ? htmlToText(message.bodyHtml.slice(0, 30_000))
            : "") ||
          message.snippet ||
          ""
        ).slice(0, 4000),
        date: (message.date ?? "").slice(0, 100),
        from: (message.from ?? "").slice(0, 1000),
        id: message.id,
        outgoing: message.labelIds?.includes(MAILBOX_LABELS.sent) ?? false,
        subject: (message.subject ?? "").slice(0, 1000),
        to: (message.to ?? "").slice(0, 1000),
      }));
    const memory = await loadAiAgentContext({
      agent: "reply_suggestion",
      mailboxId: mailbox.id,
      query: [target.from, target.subject, target.snippet]
        .filter(Boolean)
        .join(" ")
        .slice(0, 2000),
      semantic: false,
      userId: context.userId,
    });
    const model = resolveBackgroundModel();
    const requestId = randomUUID();
    generating = true;
    return await suggestReply({
      abortSignal: context.signal,
      memoryContext: serializeAiAgentContext(memory),
      messages,
      model,
      onUsage: (usage) => {
        usageReport = reportAiUsage({
          chatId: null,
          completionTokens: usage.completionTokens,
          costUsd: usage.costUsd,
          externalId: `reply-suggestion:${requestId}`,
          mailboxId: mailbox.id,
          model,
          promptTokens: usage.promptTokens,
          promptTokensDetails: {
            cacheWriteTokens: usage.cacheWriteTokens,
            cachedTokens: usage.cachedTokens,
          },
          usageKind: "aiChat",
          userId: context.userId,
        }).catch((error: unknown) => {
          reportError(error, { operation: "ai:suggest-reply:report-usage" });
        });
      },
      replyToMessageId: target.id,
    });
  } catch (error) {
    if (
      error instanceof ORPCError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      throw error;
    }
    reportError(
      generating ? new Error("Reply suggestion generation failed.") : error,
      { operation: "ai:suggest-reply" }
    );
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Could not suggest a reply right now. Please try again.",
    });
  } finally {
    await usageReport;
  }
};
