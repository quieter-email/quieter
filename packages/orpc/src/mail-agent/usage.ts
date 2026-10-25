import { reportAiUsage } from "@quieter/billing";
import type { MailboxAgentUsage } from "@quieter/database/schema";

export const reportAgentUsage = async (input: {
  externalId: string;
  mailboxId: string;
  usage: MailboxAgentUsage;
  userId: string;
}) => {
  await reportAiUsage({
    completionTokens: input.usage.completionTokens,
    costUsd: input.usage.costUsd,
    externalId: input.externalId,
    mailboxId: input.mailboxId,
    model: input.usage.model,
    promptTokens: input.usage.promptTokens,
    promptTokensDetails: {
      cacheWriteTokens: input.usage.cacheWriteTokens,
      cachedTokens: input.usage.cachedTokens,
    },
    usageKind: "mailAction",
    userId: input.userId,
  });
};
