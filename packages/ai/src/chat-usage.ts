import type { LanguageModelUsage } from "ai";

import { readChatUsageCostUsd } from "./openrouter";

export type AiUsageReport = {
  cacheWriteTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number | undefined;
  promptTokens: number;
};

type UsageStep = {
  providerMetadata?: unknown;
  usage?: LanguageModelUsage;
};

const toCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Normalizes AI SDK token usage plus the OpenRouter usage-accounting cost into
 * the report shape used by billing. Cost stays undefined when any contributing
 * step did not report one, matching the previous billing middleware behavior.
 */
export const summarizeAiUsage = (input: {
  steps: readonly UsageStep[];
  totalUsage?: LanguageModelUsage;
}): AiUsageReport => {
  const { steps, totalUsage } = input;

  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let cacheWriteTokens = 0;
  for (const step of steps) {
    promptTokens += toCount(step.usage?.inputTokens);
    completionTokens += toCount(step.usage?.outputTokens);
    cachedTokens += toCount(step.usage?.inputTokenDetails?.cacheReadTokens);
    cacheWriteTokens += toCount(
      step.usage?.inputTokenDetails?.cacheWriteTokens
    );
  }
  if (totalUsage !== undefined) {
    promptTokens = toCount(totalUsage.inputTokens);
    completionTokens = toCount(totalUsage.outputTokens);
    cachedTokens = toCount(totalUsage.inputTokenDetails?.cacheReadTokens);
    cacheWriteTokens = toCount(totalUsage.inputTokenDetails?.cacheWriteTokens);
  }

  let costUsd: number | undefined = 0;
  for (const step of steps) {
    const stepCost = readChatUsageCostUsd(step.providerMetadata);
    if (stepCost === undefined) {
      costUsd = undefined;
      break;
    }
    costUsd += stepCost;
  }

  return {
    cacheWriteTokens,
    cachedTokens,
    completionTokens,
    costUsd,
    promptTokens,
  };
};
