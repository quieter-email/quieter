import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { AiUsageReport } from "../src/chat-usage";
import {
  classifyMailMessage,
  detectMailVerificationCode,
} from "../src/classify-gmail-message";

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, OPENROUTER_API_KEY: "test-key" },
  };
});

const labels = ["Development", "Travel", "Shopping"].map((name) => ({
  description: null,
  id: name.toLowerCase(),
  inclusionCriteria: null,
  name,
}));

describe("mail classification decisions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("applies confident existing labels and reports provider cost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: {
            label0: { noul: 0.99, type: "noul" },
            label1: { noul: 0.1, type: "noul" },
            label2: { noul: 0.4, type: "noul" },
          },
          usage: { cost: 0.001, input_tokens: 200, output_tokens: 10 },
        })
      )
    );
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();
    const selected = await classifyMailMessage({
      labels,
      message: { id: "message" },
      onUsage,
    });
    expect(selected).toContain("development");
    expect(selected).not.toContain("travel");
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.001, promptTokens: 200 })
    );
  });

  test("refuses an incomplete decision rather than partially applying labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: { label0: { noul: 0.99, type: "noul" } },
          usage: { cost: 0.001, input_tokens: 200, output_tokens: 10 },
        })
      )
    );
    await expect(
      classifyMailMessage({ labels, message: { id: "message" } })
    ).rejects.toThrow(/incomplete/u);
  });

  test("refuses malformed probabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: { label0: { noul: 2, type: "noul" } },
          usage: { cost: 0.001, input_tokens: 200, output_tokens: 10 },
        })
      )
    );
    await expect(
      classifyMailMessage({ labels, message: { id: "message" } })
    ).rejects.toThrow(/noul/u);
  });

  test("does not silently reject mail when the screening decision is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: {},
          usage: { cost: 0.001, input_tokens: 200, output_tokens: 0 },
        })
      )
    );
    await expect(
      detectMailVerificationCode({ message: { id: "message" } })
    ).rejects.toThrow(/no decision/u);
  });
});
