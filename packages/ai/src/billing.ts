import {
  releaseAiCreditUsage,
  recordAiCreditProviderGeneration,
  reserveAiCreditUsage,
  settleAiCreditUsage,
} from "@quieter/billing/ai-reservation";
import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { reportError } from "@quieter/observability";
import { APICallError } from "ai";
import type { LanguageModelMiddleware } from "ai";
import { z } from "zod";

export const providerUsageResponseSchema = z.object({
  id: z.string().optional(),
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional(),
});

const mailRequestBudgets = {
  "google/gemini-3.1-flash-lite": {
    contextLength: 1_048_576,
    maxOutputTokens: 100,
    maximumCostUsd: (1_048_576 * 0.25 + 100 * 1.5) / 1_000_000,
    model: "google/gemini-3.1-flash-lite",
    provider: {
      max_price: { completion: 1.5, prompt: 0.25, request: 0 },
      only: ["google-vertex"],
    },
  },
  "typesafe/jev-1.13": {
    contextLength: 262_144,
    maximumCostUsd: (262_144 * 0.042) / 1_000_000,
    model: "typesafe/jev-1.13",
    provider: {
      max_price: { completion: 0, prompt: 0.042, request: 0 },
      only: ["typesafe"],
    },
  },
} as const;

export type MailAiRequestBudget =
  (typeof mailRequestBudgets)[keyof typeof mailRequestBudgets];

const verifiedMailContexts = new Map<string, number>();
const mailEndpointsSchema = z.object({
  data: z.object({
    endpoints: z.array(
      z.object({ context_length: z.number().int().positive(), tag: z.string() })
    ),
  }),
});

export const getMailAiRequestBudget = async (
  model: keyof typeof mailRequestBudgets,
  billing: AiBillingContext
): Promise<MailAiRequestBudget> => {
  const budget = mailRequestBudgets[model];
  if (
    billing.kind === "team" &&
    billing.account !== null &&
    (verifiedMailContexts.get(model) ?? 0) <= Date.now()
  ) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/models/${model}/endpoints`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) {
      throw new Error("The mail AI spending ceiling could not be verified.");
    }
    const { data } = mailEndpointsSchema.parse(await response.json());
    const endpoints = data.endpoints.filter(({ tag }) =>
      budget.provider.only.some(
        (provider) => tag === provider || tag.startsWith(`${provider}/`)
      )
    );
    if (
      endpoints.length === 0 ||
      endpoints.some(
        ({ context_length }) => context_length > budget.contextLength
      )
    ) {
      throw new Error("The mail AI spending ceiling has changed.");
    }
    verifiedMailContexts.set(model, Date.now() + 300_000);
  }
  return budget;
};

export type AiRequestStageMeasurement = {
  calls: number;
  ms: number;
  state: "returned" | "failed";
};
export type AiRequestDiagnostics = {
  stages: Partial<
    Record<
      "admission" | "provider" | "generation" | "settlement" | "release",
      AiRequestStageMeasurement
    >
  >;
};

export const runBilledAiRequest = async <Result>(input: {
  billing: AiBillingContext;
  maximumCostUsd?: number;
  onDiagnostics?: (diagnostics: AiRequestDiagnostics) => void;
  onProviderStart?: () => void;
  run: () => Promise<{
    costUsd: number | undefined;
    generationId?: string;
    result: Result;
  }>;
}): Promise<Result> => {
  const diagnostics: AiRequestDiagnostics = { stages: {} };
  let activeStage: {
    name: keyof AiRequestDiagnostics["stages"];
    startedAt: number;
  } | null = null;
  const recordStage = (
    next: keyof AiRequestDiagnostics["stages"] | null,
    failed = false
  ) => {
    if (input.onDiagnostics === undefined) {
      return;
    }
    if (activeStage !== null) {
      const previous = diagnostics.stages[activeStage.name];
      diagnostics.stages[activeStage.name] = {
        calls: (previous?.calls ?? 0) + 1,
        ms: (previous?.ms ?? 0) + performance.now() - activeStage.startedAt,
        state: failed || previous?.state === "failed" ? "failed" : "returned",
      };
    }
    activeStage =
      next === null ? null : { name: next, startedAt: performance.now() };
  };
  try {
    recordStage("admission");
    const reservationId = await reserveAiCreditUsage(
      input.billing,
      input.maximumCostUsd
    );
    recordStage(null);
    try {
      recordStage("provider");
      input.onProviderStart?.();
      const { costUsd, generationId, result } = await input.run();
      recordStage("generation");
      await recordAiCreditProviderGeneration({ generationId, reservationId });
      recordStage(null);
      if (costUsd === undefined) {
        throw new Error("The AI provider did not report a generation cost.");
      }
      recordStage("settlement");
      await settleAiCreditUsage({ costUsd, reservationId });
      recordStage(null);
      if (
        input.maximumCostUsd !== undefined &&
        costUsd > input.maximumCostUsd
      ) {
        const error = new Error(
          "The AI provider exceeded its spending ceiling."
        );
        reportError(error, {
          actualCostUsd: costUsd,
          maximumCostUsd: input.maximumCostUsd,
          operation: "ai:spending-ceiling",
        });
        throw error;
      }
      return result;
    } catch (error) {
      recordStage(null, true);
      if (
        APICallError.isInstance(error) &&
        [400, 401, 402, 403, 404, 413, 422, 429].includes(error.statusCode ?? 0)
      ) {
        recordStage("release");
        await releaseAiCreditUsage(reservationId);
        recordStage(null);
      }
      throw error;
    }
  } finally {
    recordStage(null, true);
    try {
      input.onDiagnostics?.(diagnostics);
    } catch {
      // Ignore diagnostic observer failures.
    }
  }
};

export const createAiBillingMiddleware = (
  billing: AiBillingContext,
  readCost: (metadata: unknown) => number | undefined,
  onProviderStart?: () => void,
  maximumCostUsd?: number
): LanguageModelMiddleware => ({
  specificationVersion: "v4",
  wrapGenerate: async ({ doGenerate, params }) => {
    params.abortSignal?.throwIfAborted();
    return await runBilledAiRequest({
      billing,
      maximumCostUsd,
      onProviderStart,
      run: async () => {
        const result = await doGenerate();
        return {
          costUsd: readCost(result.providerMetadata),
          generationId: result.response?.id,
          result,
        };
      },
    });
  },
  wrapStream: async ({ doStream, params }) => {
    params.abortSignal?.throwIfAborted();
    const reservationId = await reserveAiCreditUsage(billing, maximumCostUsd);
    try {
      onProviderStart?.();
      const result = await doStream();
      let providerStarted = false;
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            async transform(part, controller) {
              if (part.type === "error" && !providerStarted) {
                const code = APICallError.isInstance(part.error)
                  ? part.error.statusCode
                  : z.object({ code: z.number() }).safeParse(part.error).data
                      ?.code;
                if (
                  [400, 401, 402, 403, 404, 413, 422, 429].includes(code ?? 0)
                ) {
                  await releaseAiCreditUsage(reservationId);
                }
              }
              if (
                !["stream-start", "response-metadata", "raw", "error"].includes(
                  part.type
                )
              ) {
                providerStarted = true;
              }
              if (part.type === "response-metadata") {
                await recordAiCreditProviderGeneration({
                  generationId: part.id,
                  reservationId,
                });
              }
              if (part.type === "finish") {
                const costUsd = readCost(part.providerMetadata);
                if (costUsd === undefined) {
                  throw new Error(
                    "The AI provider did not report a generation cost."
                  );
                }
                await settleAiCreditUsage({ costUsd, reservationId });
              }
              controller.enqueue(part);
            },
          })
        ),
      };
    } catch (error) {
      if (
        APICallError.isInstance(error) &&
        [400, 401, 402, 403, 404, 413, 422, 429].includes(error.statusCode ?? 0)
      ) {
        await releaseAiCreditUsage(reservationId);
      }
      throw error;
    }
  },
});
