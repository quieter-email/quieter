import { getGmailMessageMetadata } from "@quieter/gmail";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { reportError } from "@quieter/observability";

import type {
  learnAiMemoryFromMailAction as LearnAiMemoryFromMailAction,
  learnAiMemoryFromSentMessage as LearnAiMemoryFromSentMessage,
} from "../ai-memory";

const GMAIL_LABEL_FEEDBACK_SOURCE_CONCURRENCY = 4;
const GMAIL_ACTION_CONTEXT_SAMPLE_SIZE = 3;
const SYSTEM_LABEL_IDS = new Set<string>(Object.values(MAILBOX_LABELS));

export type GmailActionContext = {
  senderDomains: string;
  subjects: string;
};

const listGmailLabelFeedbackSources = async (
  accessToken: string,
  messageIds: string[]
) => {
  const { getSenderSource } = await import("../mail-automation/memory");
  const uniqueMessageIds = [...new Set(messageIds)];
  const sampleIds = new Set(
    uniqueMessageIds.slice(0, GMAIL_ACTION_CONTEXT_SAMPLE_SIZE)
  );
  const sources: Record<string, ReturnType<typeof getSenderSource>> = {};
  const senderDomains = new Set<string>();
  const subjects = new Set<string>();
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
            const message = await getGmailMessageMetadata(
              accessToken,
              messageId
            );
            const from = message.payload?.headers?.find(
              (header) => header.name.toLowerCase() === "from"
            )?.value;
            const subject = message.payload?.headers?.find(
              (header) => header.name.toLowerCase() === "subject"
            )?.value;
            return [
              messageId,
              getSenderSource(from),
              subject?.slice(0, 300) ?? null,
            ] as const;
          } catch (error) {
            reportError(error, { operation: "mail:label-feedback-source" });
            return [messageId, null, null] as const;
          }
        })
    );
    for (const [messageId, source, subject] of entries) {
      sources[messageId] = source;
      if (sampleIds.has(messageId)) {
        if (source) {
          senderDomains.add(source);
        }
        if (subject) {
          subjects.add(subject);
        }
      }
    }
  }
  return {
    context: {
      senderDomains: [...senderDomains].join(", "),
      subjects: [...subjects].join("; "),
    },
    sources,
  };
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
  if (
    [...(input.addLabelIds ?? []), ...(input.removeLabelIds ?? [])].every(
      (labelId) => SYSTEM_LABEL_IDS.has(labelId)
    )
  ) {
    return null;
  }
  const { accessToken, ...feedback } = input;
  try {
    const { context, sources } = await listGmailLabelFeedbackSources(
      accessToken,
      input.providerMessageIds
    );
    await recordLabelFeedback({
      ...feedback,
      messageSources: sources,
    });
    return context;
  } catch (error) {
    reportError(error, { operation: "mail:record-label-feedback" });
    return null;
  }
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
  try {
    const aiMemory = await import("../ai-memory");
    await aiMemory.learnAiMemoryFromMailAction(input);
  } catch (error) {
    reportError(error, { operation: "mail:record-memory-action" });
  }
};

export const learnAiMemoryFromGmailAction = async (
  input: MailActionMemoryInput & { accessToken: string }
) => {
  const { accessToken, ...action } = input;
  const metadata = { ...action.metadata };
  try {
    const { getPersonalAiMemoryScopeConfig } = await import("../ai-memory");
    const config = await getPersonalAiMemoryScopeConfig(action.userId);
    if (!config.activeLearningEnabled) {
      return;
    }
    if (
      metadata.senderDomains === undefined &&
      metadata.subjects === undefined
    ) {
      const { getSenderSource } = await import("../mail-automation/memory");
      const sample = [...new Set(action.messageIds)].slice(
        0,
        GMAIL_ACTION_CONTEXT_SAMPLE_SIZE
      );
      const contexts = await Promise.all(
        sample.map(async (messageId) => {
          try {
            const message = await getGmailMessageMetadata(
              accessToken,
              messageId
            );
            return {
              senderDomain: getSenderSource(
                message.payload?.headers?.find(
                  (header) => header.name.toLowerCase() === "from"
                )?.value
              ),
              subject:
                message.payload?.headers
                  ?.find((header) => header.name.toLowerCase() === "subject")
                  ?.value?.slice(0, 300) ?? null,
            };
          } catch (error) {
            reportError(error, { operation: "mail:action-context" });
            return null;
          }
        })
      );
      metadata.senderDomains = [
        ...new Set(
          contexts.flatMap((entry) =>
            entry?.senderDomain ? [entry.senderDomain] : []
          )
        ),
      ].join(", ");
      metadata.subjects = [
        ...new Set(
          contexts.flatMap((entry) => (entry?.subject ? [entry.subject] : []))
        ),
      ].join("; ");
    }
  } catch (error) {
    reportError(error, { operation: "mail:action-context" });
  }
  await learnAiMemoryFromMailAction({ ...action, metadata });
};
