import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import type { AiUsageReport } from "../src/chat-usage";
import { runStructuredGeneration } from "../src/generation";

const state = vi.hoisted(() => ({
  model: vi.fn<() => MockLanguageModelV4>(),
}));
vi.mock(import("../src/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: state.model,
}));

type Generation = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const response = (input: {
  costUsd?: number;
  empty?: boolean;
  text?: string;
}): Generation => ({
  content:
    input.empty === true
      ? []
      : [{ text: input.text ?? '{"value":42}', type: "text" }],
  finishReason: {
    raw: undefined,
    unified: input.empty === true ? "length" : "stop",
  },
  ...(input.costUsd === undefined
    ? {}
    : { providerMetadata: { openrouter: { usage: { cost: input.costUsd } } } }),
  usage: {
    inputTokens: { cacheRead: 3, cacheWrite: 2, noCache: 5, total: 10 },
    outputTokens: { reasoning: 2, text: 3, total: 5 },
  },
  warnings: [],
});

const generationInput = {
  maxOutputTokens: 100,
  prompt: "Return a value.",
  schema: z.object({ value: z.number() }),
  system: "Return structured output.",
};

describe("structured generation recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("recovers empty output and reports the combined billed usage once", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        response({ costUsd: 0.125, empty: true }),
        response({ costUsd: 0.25 }),
      ],
    });
    state.model.mockReturnValue(model);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();

    await expect(
      runStructuredGeneration({ ...generationInput, onUsage })
    ).resolves.toMatchObject({ value: 42 });

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cacheWriteTokens: 4,
        cachedTokens: 6,
        completionTokens: 10,
        costUsd: 0.375,
        promptTokens: 20,
      })
    );
  });

  test("keeps persistent empty output visible and accounts for both attempts", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: response({ costUsd: 0.125, empty: true }),
    });
    state.model.mockReturnValue(model);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();

    await expect(
      runStructuredGeneration({ ...generationInput, onUsage })
    ).rejects.toThrow(NoOutputGeneratedError);

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ costUsd: 0.25, promptTokens: 20 })
    );
  });

  test.each([
    [undefined, 0.25],
    [0.125, undefined],
  ])(
    "preserves unknown cost from either attempt (%s, %s)",
    async (firstCost, secondCost) => {
      const model = new MockLanguageModelV4({
        doGenerate: [
          response({ costUsd: firstCost, empty: true }),
          response({ costUsd: secondCost }),
        ],
      });
      state.model.mockReturnValue(model);
      const onUsage = vi.fn<(usage: AiUsageReport) => void>();

      await runStructuredGeneration({ ...generationInput, onUsage });

      expect(onUsage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ costUsd: undefined, promptTokens: 20 })
      );
    }
  );

  test("does not replay invalid nonempty output and retains its billed usage", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: response({ costUsd: 0.125, text: '{"value":"invalid"}' }),
    });
    state.model.mockReturnValue(model);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();

    await expect(
      runStructuredGeneration({ ...generationInput, onUsage })
    ).rejects.toThrow(NoObjectGeneratedError);

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ costUsd: 0.125, promptTokens: 10 })
    );
  });

  test("preserves the final error after an empty attempt", async () => {
    const finalError = new Error("Generation unavailable");
    const doGenerate = vi
      .fn<MockLanguageModelV4["doGenerate"]>()
      .mockResolvedValueOnce(response({ costUsd: 0.125, empty: true }))
      .mockRejectedValueOnce(finalError);
    const model = new MockLanguageModelV4({ doGenerate });
    state.model.mockReturnValue(model);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();

    await expect(
      runStructuredGeneration({ ...generationInput, onUsage })
    ).rejects.toBe(finalError);

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ costUsd: 0.125, promptTokens: 10 })
    );
  });

  test("does not retry a provider error that only shares the empty-output name", async () => {
    const error = new Error("Unavailable");
    error.name = "AI_NoOutputGeneratedError";
    const model = new MockLanguageModelV4({
      doGenerate: vi
        .fn<MockLanguageModelV4["doGenerate"]>()
        .mockRejectedValue(error),
    });
    state.model.mockReturnValue(model);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();

    await expect(
      runStructuredGeneration({ ...generationInput, onUsage })
    ).rejects.toBe(error);

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(onUsage).not.toHaveBeenCalled();
  });

  test("does not replay empty output after cancellation", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      // oxlint-disable-next-line eslint/require-await -- The SDK expects a promise-returning provider callback.
      doGenerate: async () => {
        controller.abort();
        return response({ costUsd: 0.125, empty: true });
      },
    });
    state.model.mockReturnValue(model);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();

    await expect(
      runStructuredGeneration({
        ...generationInput,
        abortSignal: controller.signal,
        onUsage,
      })
    ).rejects.toThrow(NoOutputGeneratedError);

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ costUsd: 0.125, promptTokens: 10 })
    );
  });
});
