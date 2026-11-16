import { ORPCError } from "@orpc/server";
import { reportError } from "@quieter/observability";

import type { AiOrigin } from "../ai-authority";
import type { learnAiMemoryFromMailAction as LearnAiMemoryFromMailAction } from "../ai-memory";

type MailActionMemoryInput = Parameters<typeof LearnAiMemoryFromMailAction>[0];

export const recordLabelFeedback = async (input: {
  origin?: AiOrigin;
  addLabelIds?: string[];
  mailboxId: string;
  messageSources?: Record<string, string | null | undefined>;
  providerMessageIds: string[];
  removeLabelIds?: string[];
  userId: string;
}) => {
  try {
    const { recordMailAutoLabelFeedback } =
      await import("../mail-automation/memory");
    return await recordMailAutoLabelFeedback(input);
  } catch (error) {
    if (!(error instanceof ORPCError) || error.status >= 500) {
      reportError(error, { operation: "mail:record-auto-label-feedback" });
    }
    return null;
  }
};

export const learnAiMemoryFromMailAction = async (
  input: MailActionMemoryInput
) => {
  try {
    const aiMemory = await import("../ai-memory");
    return await aiMemory.learnAiMemoryFromMailAction(input);
  } catch (error) {
    if (!(error instanceof ORPCError) || error.status >= 500) {
      reportError(error, { operation: "mail:record-memory-action" });
    }
    return { status: "failed" as const };
  }
};

export const learnAiMemoryFromGmailAction = async (
  input: MailActionMemoryInput & { accessToken: string; eventId?: string }
) => {
  const { queueMailboxMessageMemory } = await import("../ai-memory-capture");
  await queueMailboxMessageMemory({
    mailboxId: input.mailboxId,
    messageIds: input.messageIds ?? [],
    origin: input.origin,
    userId: input.userId,
  });
  await learnAiMemoryFromMailAction({
    action: input.action,
    eventKey: input.eventKey ?? input.eventId,
    mailboxId: input.mailboxId,
    messageIds: input.messageIds,
    metadata: input.metadata,
    origin: input.origin,
    targetCount: input.targetCount,
    userId: input.userId,
  });
};
