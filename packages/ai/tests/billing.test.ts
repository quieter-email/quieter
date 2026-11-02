import type * as ReservationModule from "@quieter/billing/ai-reservation";
import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { APICallError, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { createAiBillingMiddleware, runBilledAiRequest } from "../src/billing";
import { detectMailVerificationCode } from "../src/classify-gmail-message";
import { openRouterStreamMiddleware } from "../src/openrouter-stream";
import { generateOpenRouterTranscription } from "../src/openrouter-transcription";

const state = vi.hoisted(() => ({
  generation:
    vi.fn<typeof ReservationModule.recordAiCreditProviderGeneration>(),
  release: vi.fn<typeof ReservationModule.releaseAiCreditUsage>(),
  reserve: vi.fn<typeof ReservationModule.reserveAiCreditUsage>(),
  settle: vi.fn<typeof ReservationModule.settleAiCreditUsage>(),
}));
vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  recordAiCreditProviderGeneration: state.generation,
  releaseAiCreditUsage: state.release,
  reserveAiCreditUsage: state.reserve,
  settleAiCreditUsage: state.settle,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, OPENROUTER_API_KEY: "fixture" },
  };
});

const billing: AiBillingContext = {
  account: null,
  admittedAt: new Date(),
  groupId: "operation",
  kind: "team" as const,
  organizationId: "team",
  usageKind: "aiChat",
};

describe("paid provider admission and settlement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.reserve.mockResolvedValue("00000000-0000-0000-0000-000000000001");
    state.settle.mockResolvedValue(void 0);
    state.release.mockResolvedValue(void 0);
  });
  afterEach(() => vi.unstubAllGlobals());

  test.each(["transcription", "decisions"])(
    "blocks %s before its HTTP sink when reservation fails",
    async (kind) => {
      const fetchProvider = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetchProvider);
      state.reserve.mockRejectedValue(new Error("Unavailable balance"));
      const request =
        kind === "transcription"
          ? generateOpenRouterTranscription({
              audioBase64: "AA==",
              billing,
              format: "wav",
            })
          : detectMailVerificationCode({
              billing,
              message: { bodyText: "Synthetic content", id: "message" },
            });
      await expect(request).rejects.toThrow(/Unavailable balance/u);
      expect(fetchProvider).not.toHaveBeenCalled();
    }
  );

  test.each(["transcription", "decisions"])(
    "reconciles %s usage before returning its result",
    async (kind) => {
      const fetchProvider = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          kind === "transcription"
            ? { text: "Synthetic transcript", usage: { cost: 0.01 } }
            : {
                answers: { verificationCode: { noul: 0.5, type: "noul" } },
                usage: { cost: 0.01, input_tokens: 4, output_tokens: 2 },
              }
        )
      );
      vi.stubGlobal("fetch", fetchProvider);
      if (kind === "transcription") {
        await generateOpenRouterTranscription({
          audioBase64: "AA==",
          billing,
          format: "wav",
        });
      } else {
        await detectMailVerificationCode({
          billing,
          message: { bodyText: "Synthetic content", id: "message" },
        });
      }
      expect(state.settle).toHaveBeenCalledWith(
        expect.objectContaining({
          costUsd: 0.01,
          reservationId: "00000000-0000-0000-0000-000000000001",
        })
      );
    }
  );

  test.each([402, 413])(
    "provider rejection %i releases unused funds",
    async (statusCode) => {
      const refusal = new APICallError({
        message: "Rejected",
        requestBodyValues: {},
        statusCode,
        url: "https://example.invalid",
      });
      await expect(
        runBilledAiRequest({
          billing,
          run: async () => {
            await Promise.resolve();
            throw refusal;
          },
        })
      ).rejects.toBe(refusal);
      expect(state.release).toHaveBeenCalledOnce();
      expect(state.settle).not.toHaveBeenCalled();
    }
  );

  test("confirmed rejection releases funds while unknown failure, cancellation and missing usage retain the hold", async () => {
    const refusal = new APICallError({
      message: "Rejected",
      requestBodyValues: {},
      statusCode: 429,
      url: "https://example.invalid",
    });
    await expect(
      runBilledAiRequest({
        billing,
        run: async () => {
          await Promise.resolve();
          throw refusal;
        },
      })
    ).rejects.toBe(refusal);
    expect(state.release).toHaveBeenCalledOnce();
    for (const error of [
      new Error("Connection lost"),
      new DOMException("Cancelled", "AbortError"),
    ]) {
      await expect(
        runBilledAiRequest({
          billing,
          run: async () => {
            await Promise.resolve();
            throw error;
          },
        })
      ).rejects.toBe(error);
    }
    await expect(
      runBilledAiRequest({
        billing,
        run: async () => {
          await Promise.resolve();
          return { costUsd: undefined, result: "Unaccounted" };
        },
      })
    ).rejects.toThrow(/did not report/u);
    expect(state.release).toHaveBeenCalledOnce();
    expect(state.settle).not.toHaveBeenCalled();
  });

  test("the shared SDK boundary blocks generation before invoking the model", async () => {
    const provider = new MockLanguageModelV4();
    const model = wrapLanguageModel({
      middleware: createAiBillingMiddleware(billing, () => 0.01),
      model: provider,
    });
    state.reserve.mockRejectedValue(new Error("Unavailable balance"));
    await expect(model.doGenerate({ prompt: [] })).rejects.toThrow(
      /Unavailable balance/u
    );
    await expect(model.doStream({ prompt: [] })).rejects.toThrow(
      /Unavailable balance/u
    );
    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(provider.doStreamCalls).toHaveLength(0);
  });

  test("an already aborted request reserves nothing", async () => {
    const provider = new MockLanguageModelV4();
    const model = wrapLanguageModel({
      middleware: createAiBillingMiddleware(billing, () => 0),
      model: provider,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      model.doGenerate({ abortSignal: controller.signal, prompt: [] })
    ).rejects.toThrow(/abort/iu);
    await expect(
      model.doStream({ abortSignal: controller.signal, prompt: [] })
    ).rejects.toThrow(/abort/iu);
    expect(state.reserve).not.toHaveBeenCalled();
    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(provider.doStreamCalls).toHaveLength(0);
  });

  test("cancelling a stream preserves its provider identity for reconciliation", async () => {
    const provider = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              id: "gen-fixture",
              type: "response-metadata",
            });
            controller.enqueue({ id: "text", type: "text-start" });
          },
        }),
      },
    });
    const model = wrapLanguageModel({
      middleware: [
        openRouterStreamMiddleware,
        createAiBillingMiddleware(billing, () => void 0),
      ],
      model: provider,
    });
    const { stream } = await model.doStream({ prompt: [] });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(state.generation).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "gen-fixture" })
    );
    expect(state.release).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
  });

  test("a confirmed initial streaming refusal releases before the SDK retries", async () => {
    const provider = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              error: { code: 429, message: "Busy" },
              type: "error",
            });
            controller.close();
          },
        }),
      },
    });
    const model = wrapLanguageModel({
      middleware: [
        openRouterStreamMiddleware,
        createAiBillingMiddleware(billing, () => void 0),
      ],
      model: provider,
    });
    await expect(model.doStream({ prompt: [] })).rejects.toThrow(/Busy/u);
    expect(state.release).toHaveBeenCalledOnce();
  });

  test("a streaming turn settles before its finish reaches tools or the next model turn", async () => {
    const provider = new MockLanguageModelV4({
      doStream: {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              finishReason: { raw: "stop", unified: "stop" },
              type: "finish",
              usage: {
                inputTokens: {
                  cacheRead: 0,
                  cacheWrite: 0,
                  noCache: 1,
                  total: 1,
                },
                outputTokens: { reasoning: 0, text: 1, total: 1 },
              },
            });
            controller.close();
          },
        }),
      },
    });
    const model = wrapLanguageModel({
      middleware: createAiBillingMiddleware(billing, () => 0.01),
      model: provider,
    });
    const { stream } = await model.doStream({ prompt: [] });
    const reader = stream.getReader();
    const finish = await reader.read();
    expect(finish.value?.type).toBe("finish");
    expect(state.settle).toHaveBeenCalledOnce();
    await reader.cancel();
    expect(state.release).not.toHaveBeenCalled();
  });
});
