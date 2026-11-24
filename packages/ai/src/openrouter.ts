import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { serverEnv } from "@quieter/env/server";
import { wrapLanguageModel } from "ai";
import { z } from "zod";

import { createAiBillingMiddleware } from "./billing";
import type { GenerationModel } from "./chat-models";
import {
  chatModelSchema,
  memoryLearningModel,
  resolveModelFallbacks,
} from "./chat-models";
import { openRouterStreamMiddleware } from "./openrouter-stream";

let cachedProvider: ReturnType<typeof createOpenRouter> | null = null;
const memoryLearningMaxPrice = { completion: 0.5, prompt: 0.1, request: 0 };

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
  model: GenerationModel,
  options: {
    billing: AiBillingContext;
    onProviderStart?: () => void;
    allowFallbacks?: boolean;
    prioritizeLatency?: boolean;
  }
) => {
  const parsedModel =
    model === memoryLearningModel ? model : chatModelSchema.parse(model);
  const fallbacks =
    options.allowFallbacks === false || parsedModel === memoryLearningModel
      ? []
      : resolveModelFallbacks(parsedModel);
  const providerRouting = {
    ...(options.prioritizeLatency === true ? { sort: "latency" } : {}),
    ...(parsedModel === memoryLearningModel
      ? { max_price: memoryLearningMaxPrice, only: ["azure"] }
      : {}),
    zdr: true,
  };
  return wrapLanguageModel({
    middleware: [
      openRouterStreamMiddleware,
      {
        specificationVersion: "v4",
        // oxlint-disable-next-line eslint/require-await -- The SDK requires a promise-returning transform without I/O.
        transformParams: async ({ params }) =>
          params.responseFormat?.type === "json" &&
          params.responseFormat.schema !== undefined
            ? {
                ...params,
                providerOptions: {
                  ...params.providerOptions,
                  openrouter: {
                    ...params.providerOptions?.openrouter,
                    provider: {
                      ...providerRouting,
                      require_parameters: true,
                    },
                  },
                },
              }
            : params,
      },
      createAiBillingMiddleware(
        options.billing,
        readChatUsageCostUsd,
        options.onProviderStart,
        parsedModel === memoryLearningModel
          ? (params) => {
              // The serialized input includes the prompt and structured output schema.
              const bytes = new TextEncoder().encode(
                JSON.stringify(params)
              ).length;
              return (
                ((bytes * 2 + 4096) * memoryLearningMaxPrice.prompt +
                  (params.maxOutputTokens ?? 0) *
                    memoryLearningMaxPrice.completion) /
                1_000_000
              );
            }
          : undefined
      ),
    ],
    model: getOpenRouterProvider().chat(parsedModel, {
      extraBody: {
        ...(fallbacks.length > 0 ? { models: fallbacks } : {}),
        provider: providerRouting,
      },
      usage: { include: true },
    }),
  });
};
