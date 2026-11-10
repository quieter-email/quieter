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

import {
  createAiBillingMiddleware,
  getMailAiRequestBudget,
  runBilledAiRequest,
} from "../src/billing";
import type { AiRequestDiagnostics } from "../src/billing";
import { detectMailVerificationCode } from "../src/classify-gmail-message";
import { createChatModel } from "../src/openrouter";
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

  test("a failing diagnostic observer preserves successful settlement and rejected-provider release", async () => {
    const snapshots: AiRequestDiagnostics[] = [];
    const onDiagnostics = (diagnostics: AiRequestDiagnostics) => {
      snapshots.push(diagnostics);
      throw new Error("Observer failed");
    };
    const result = { value: "Private provider result" };
    await expect(
      runBilledAiRequest({
        billing,
        onDiagnostics,
        run: async () => {
          await Promise.resolve();
          return { costUsd: 0.01, result };
        },
      })
    ).resolves.toBe(result);
    expect(state.settle).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.01 })
    );
    const refusal = new APICallError({
      message: "Private provider error",
      requestBodyValues: {},
      statusCode: 429,
      url: "https://example.invalid",
    });
    await expect(
      runBilledAiRequest({
        billing,
        onDiagnostics,
        run: async () => {
          await Promise.resolve();
          throw refusal;
        },
      })
    ).rejects.toBe(refusal);
    expect(state.release).toHaveBeenCalledOnce();
    expect(snapshots[0]?.stages.settlement?.state).toBe("returned");
    expect(snapshots[1]?.stages.provider?.state).toBe("failed");
    expect(snapshots[1]?.stages.release?.state).toBe("returned");
    expect(JSON.stringify(snapshots)).not.toMatch(/Private|operation|team/u);
  });

  test.each(["admission", "generation", "settlement"] as const)(
    "emits a partial %s failure without releasing an unresolved hold",
    async (stage) => {
      const failure = new Error("Private ledger failure");
      if (stage === "admission") {
        state.reserve.mockRejectedValue(failure);
      } else if (stage === "generation") {
        state.generation.mockRejectedValue(failure);
      } else {
        state.settle.mockRejectedValue(failure);
      }
      const snapshots: AiRequestDiagnostics[] = [];
      await expect(
        runBilledAiRequest({
          billing,
          onDiagnostics: (diagnostics) => {
            snapshots.push(diagnostics);
          },
          run: async () => {
            await Promise.resolve();
            return { costUsd: 0.01, result: "Private result" };
          },
        })
      ).rejects.toBe(failure);
      expect(snapshots[0]?.stages[stage]?.state).toBe("failed");
      expect(state.release).not.toHaveBeenCalled();
      expect(JSON.stringify(snapshots)).not.toMatch(/Private|operation|team/u);
    }
  );

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

  test("preserves the provider's actual cost and rejects its output when it violates the admitted ceiling", async () => {
    const costUsd = 0.02;
    await expect(
      runBilledAiRequest({
        billing,
        maximumCostUsd: 0.01,
        run: async () => {
          await Promise.resolve();
          return { costUsd, result: "Untrusted result" };
        },
      })
    ).rejects.toThrow(/exceeded.*ceiling/u);
    expect(state.settle).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd })
    );
    expect(state.release).not.toHaveBeenCalled();
  });

  test("refuses mail provider dispatch when its native context no longer fits the complete hold", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: {
          endpoints: [
            { context_length: Number.MAX_SAFE_INTEGER, tag: "typesafe" },
          ],
        },
      })
    );
    vi.stubGlobal("fetch", provider);
    await expect(
      detectMailVerificationCode({
        billing: {
          ...billing,
          account: {
            creditAmountCents: 100,
            currentPeriodEnd: new Date(Date.now() + 3_600_000),
            currentPeriodStart: new Date(),
            externalCustomerId: "synthetic-account",
            organizationId: billing.organizationId,
            product: "pro",
          },
        },
        message: { bodyText: "Synthetic content", id: "message" },
      })
    ).rejects.toThrow(/ceiling has changed/u);
    expect(state.reserve).not.toHaveBeenCalled();
    expect(
      provider.mock.calls.every(([input]) =>
        new Request(input).url.endsWith("/endpoints")
      )
    ).toBeTruthy();
  });

  test.each([
    { max_tokens: 1_000_000 },
    { models: ["unbounded-model"] },
    { plugins: [{ id: "web" }] },
  ])(
    "rejects call-level provider options that could bypass the mail spending contract",
    async (override) => {
      const provider = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", provider);
      const model = createChatModel("google/gemini-3.1-flash-lite", {
        billing,
        mailRequestBudget: await getMailAiRequestBudget(
          "google/gemini-3.1-flash-lite",
          { kind: "development" }
        ),
      });
      await expect(
        model.doGenerate({
          maxOutputTokens: 100,
          prompt: [],
          providerOptions: { openrouter: override },
        })
      ).rejects.toThrow(/exceeds.*ceiling/u);
      expect(provider).not.toHaveBeenCalled();
      expect(state.reserve).not.toHaveBeenCalled();
    }
  );

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
