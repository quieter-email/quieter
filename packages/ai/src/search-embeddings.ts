import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { serverEnv } from "@quieter/env/server";
import { APICallError } from "ai";
import { z } from "zod";

import { providerUsageResponseSchema, runBilledAiRequest } from "./billing";
import type { AiUsageReport } from "./chat-usage";

export const SEARCH_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const SEARCH_EMBEDDING_DIMENSIONS = 1024;
export const SEARCH_EMBEDDING_MODEL_KEY =
  "openai/text-embedding-3-small:1024:v1";

const searchTextsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(8000)
      .refine(
        // oxlint-disable-next-line typescript/no-misused-spread -- Match PostgreSQL character counts in Unicode code points, not graphemes.
        (value) => value.trim().length > 0 && [...value].length <= 2000
      )
  )
  .min(1)
  .max(17);
const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z
        .array(z.number())
        .length(SEARCH_EMBEDDING_DIMENSIONS)
        .refine(
          (values) =>
            values.some((value) => Math.fround(value) !== 0) &&
            values.every((value) => Number.isFinite(Math.fround(value)))
        ),
      index: z.number().int().nonnegative(),
    })
  ),
  model: z.enum([SEARCH_EMBEDDING_MODEL, "text-embedding-3-small"]),
});
const tokenUsageSchema = z.object({
  usage: z.object({ prompt_tokens: z.number().int().nonnegative() }),
});

export const embedSearchTexts = async (input: {
  billing: AiBillingContext;
  values: string[];
  signal?: AbortSignal;
  onUsage?: (usage: AiUsageReport) => void;
}): Promise<number[][]> => {
  const values = searchTextsSchema.safeParse(input.values);
  if (!values.success) {
    throw new Error("The search text exceeds the supported request limits.");
  }
  input.signal?.throwIfAborted();
  const apiKey = serverEnv.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("AI features are temporarily unavailable.");
  }
  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  const payload = await runBilledAiRequest({
    billing: input.billing,
    run: async () => {
      const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
        body: JSON.stringify({
          dimensions: SEARCH_EMBEDDING_DIMENSIONS,
          encoding_format: "float",
          input: values.data,
          model: SEARCH_EMBEDDING_MODEL,
          provider: { require_parameters: true, zdr: true },
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://quieter.email",
          "X-Title": "quieter",
        },
        method: "POST",
        signal,
      });
      if (!response.ok) {
        throw new APICallError({
          message: "Search is temporarily unavailable. Try again.",
          requestBodyValues: {},
          statusCode: response.status,
          url: "https://openrouter.ai/api/v1/embeddings",
        });
      }
      const result: unknown = await response.json();
      const cost = providerUsageResponseSchema
        .pick({ usage: true })
        .safeParse(result).data?.usage?.cost;
      const generationId = providerUsageResponseSchema
        .pick({ id: true })
        .safeParse(result).data?.id;
      return {
        costUsd: cost,
        generationId,
        result,
      };
    },
  });
  const usage = providerUsageResponseSchema
    .pick({ usage: true })
    .parse(payload);
  input.onUsage?.({
    cacheWriteTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    costUsd: usage.usage?.cost,
    promptTokens:
      tokenUsageSchema.safeParse(payload).data?.usage.prompt_tokens ?? 0,
  });
  const result = embeddingResponseSchema.safeParse(payload);
  if (
    !result.success ||
    result.data.data.length !== values.data.length ||
    new Set(result.data.data.map((entry) => entry.index)).size !==
      values.data.length ||
    result.data.data.some((entry) => entry.index >= values.data.length)
  ) {
    throw new Error("Search returned an invalid response. Try again.");
  }
  return result.data.data
    .toSorted((left, right) => left.index - right.index)
    .map((entry) => entry.embedding);
};
