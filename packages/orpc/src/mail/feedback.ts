import { getGmailMessageSender } from "@quieter/gmail";
import { reportError } from "@quieter/observability";

import type {
  learnAiMemoryFromMailAction as LearnAiMemoryFromMailAction,
  learnAiMemoryFromSentMessage as LearnAiMemoryFromSentMessage,
} from "../ai-memory";

const GMAIL_LABEL_FEEDBACK_SOURCE_CONCURRENCY = 4;

const listGmailLabelFeedbackSources = async (
  accessToken: string,
  messageIds: string[]
) => {
  const { getSenderSource } = await import("../mail-automation/memory");
  const uniqueMessageIds = [...new Set(messageIds)];
  const sources: Record<string, ReturnType<typeof getSenderSource>> = {};
  for (
    let index = 0;
    index < uniqueMessageIds.length;
    index += GMAIL_LABEL_FEEDBACK_SOURCE_CONCURRENCY
  ) {
    const entries = await Promise.all(
      uniqueMessageIds
        .slice(index, index + GMAIL_LABEL_FEEDBACK_SOURCE_CONCURRENCY)
        .map(async (messageId) => {
          try {
            return [
              messageId,
              getSenderSource(
                await getGmailMessageSender(accessToken, messageId)
              ),
            ] as const;
          } catch (error) {
            reportError(error, { operation: "mail:label-feedback-source" });
            return [messageId, null] as const;
          }
        })
    );
    Object.assign(sources, Object.fromEntries(entries));
  }
  return sources;
};

type SentMessageMemoryInput = Parameters<
  typeof LearnAiMemoryFromSentMessage
>[0];

type MailActionMemoryInput = Parameters<typeof LearnAiMemoryFromMailAction>[0];

export const recordLabelFeedback = async (input: {
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
    await recordMailAutoLabelFeedback(input);
  } catch (error) {
    reportError(error, { operation: "mail:record-auto-label-feedback" });
  }
};

export const recordGmailLabelFeedback = async (input: {
  accessToken: string;
  addLabelIds?: string[];
  mailboxId: string;
  providerMessageIds: string[];
  removeLabelIds?: string[];
  userId: string;
}) => {
  const { accessToken, ...feedback } = input;
  await recordLabelFeedback({
    ...feedback,
    messageSources: await listGmailLabelFeedbackSources(
      accessToken,
      input.providerMessageIds
    ),
  });
};

export const learnAiMemoryFromSentMessage = async (
  input: SentMessageMemoryInput
) => {
  const aiMemory = await import("../ai-memory");
  return await aiMemory.learnAiMemoryFromSentMessage(input);
};

export const learnAiMemoryFromMailAction = async (
  input: MailActionMemoryInput
) => {
  const aiMemory = await import("../ai-memory");
  return await aiMemory.learnAiMemoryFromMailAction(input);
};
