import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { serverEnv } from "@quieter/env/server";

import type { ChatModel } from "./chat-models";
import { chatModelSchema } from "./chat-models";

let cachedProvider: ReturnType<typeof createOpenRouter> | null = null;

const getOpenRouterProvider = () => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;

  if (apiKey === undefined || apiKey === "") {
    throw new Error("AI features are temporarily unavailable.");
  }

  cachedProvider ??= createOpenRouter({
    apiKey,
    appName: "quieter",
    appUrl: "https://quieter.email",
  });
  return cachedProvider;
};

export type ChatUsageReport = {
  cacheWriteTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number | undefined;
  promptTokens: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Reads the OpenRouter usage accounting payload enabled through the model's
 * `usage.include` setting. The cost field is what Polar billing relies on.
 */
export const readChatUsageCostUsd = (
  providerMetadata: unknown
): number | undefined => {
  if (!isRecord(providerMetadata)) {
    return undefined;
  }
  const { openrouter } = providerMetadata;
  if (!isRecord(openrouter)) {
    return undefined;
  }
  const { usage } = openrouter;
  if (!isRecord(usage)) {
    return undefined;
  }
  return typeof usage.cost === "number" ? usage.cost : undefined;
};

/**
 * Creates the language model for a chat model id with zero-data-retention
 * routing and OpenRouter usage accounting (token costs) always enabled.
 */
export const createChatModel = (model: ChatModel) => {
  const parsedModel = chatModelSchema.parse(model);
  return getOpenRouterProvider().chat(parsedModel, {
    extraBody: {
      provider: {
        zdr: true,
      },
    },
    usage: { include: true },
  });
};
