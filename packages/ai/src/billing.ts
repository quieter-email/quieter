import {
  releaseAiCreditUsage,
  recordAiCreditProviderGeneration,
  reserveAiCreditUsage,
  settleAiCreditUsage,
} from "@quieter/billing/ai-reservation";
import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { APICallError } from "ai";
import type { LanguageModelMiddleware } from "ai";
import { z } from "zod";

export const providerUsageResponseSchema = z.object({
  id: z.string().optional(),
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional(),
});

export const runBilledAiRequest = async <Result>(input: {
  billing: AiBillingContext;
  run: () => Promise<{
    costUsd: number | undefined;
    generationId?: string;
    result: Result;
  }>;
}): Promise<Result> => {
  const reservationId = await reserveAiCreditUsage(input.billing);
  try {
    const { costUsd, generationId, result } = await input.run();
    await recordAiCreditProviderGeneration({ generationId, reservationId });
    if (costUsd === undefined) {
      throw new Error("The AI provider did not report a generation cost.");
    }
    await settleAiCreditUsage({ costUsd, reservationId });
    return result;
  } catch (error) {
    if (
      APICallError.isInstance(error) &&
      [400, 401, 402, 403, 404, 413, 422, 429].includes(error.statusCode ?? 0)
    ) {
      await releaseAiCreditUsage(reservationId);
    }
    throw error;
  }
};

export const createAiBillingMiddleware = (
  billing: AiBillingContext,
  readCost: (metadata: unknown) => number | undefined
): LanguageModelMiddleware => ({
  specificationVersion: "v4",
  wrapGenerate: async ({ doGenerate, params }) => {
    params.abortSignal?.throwIfAborted();
    return await runBilledAiRequest({
      billing,
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
    const reservationId = await reserveAiCreditUsage(billing);
    try {
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
