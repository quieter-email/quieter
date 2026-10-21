import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { serverEnv } from "@quieter/env/server";
import { wrapLanguageModel } from "ai";
import { z } from "zod";

import type { ChatModel } from "./chat-models";
import { chatModelSchema, resolveModelFallbacks } from "./chat-models";
import { openRouterStreamMiddleware } from "./openrouter-stream";

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

const openRouterUsageMetadataSchema = z.looseObject({
  openrouter: z.looseObject({
    usage: z.looseObject({ cost: z.number() }),
  }),
});

/**
 * Reads the OpenRouter usage accounting payload enabled through the model's
 * `usage.include` setting. The cost field is what Polar billing relies on.
 */
export const readChatUsageCostUsd = (
  providerMetadata: unknown
): number | undefined =>
  openRouterUsageMetadataSchema.safeParse(providerMetadata).data?.openrouter
    ?.usage?.cost;

/**
 * Keeps zero-data-retention routing and usage accounting enabled. Latest
 * family choices stay in that family; pinned configurations retain their
 * provider-constrained failover order.
 */
export const createChatModel = (
  model: ChatModel,
  options?: { prioritizeLatency?: boolean }
) => {
  const parsedModel = chatModelSchema.parse(model);
  const fallbacks = resolveModelFallbacks(parsedModel);
  return wrapLanguageModel({
    middleware: openRouterStreamMiddleware,
    model: getOpenRouterProvider().chat(parsedModel, {
      extraBody: {
        ...(fallbacks.length > 0 ? { models: fallbacks } : {}),
        provider: {
          ...(options?.prioritizeLatency === true ? { sort: "latency" } : {}),
          zdr: true,
        },
      },
      usage: { include: true },
    }),
  });
};
