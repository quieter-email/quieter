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

  test("selects a primary category and overlapping labels in one model call", async () => {
    const fetchModel = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        answers: {
          category: {
            choice: "label0",
            confidence: 0.4,
            probabilities: { label0: 0.55, label1: 0.35, label2: 0.1 },
            type: "choice",
          },
          label0: { noul: 0.75, type: "noul" },
          label1: { noul: 0.8, type: "noul" },
          label2: { noul: 0.4, type: "noul" },
        },
        usage: { cost: 0.001, input_tokens: 200, output_tokens: 10 },
      })
    );
    vi.stubGlobal("fetch", fetchModel);
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();
    const selected = await classifyMailMessage({
      labels,
      message: { id: "message" },
      onUsage,
    });
    expect(selected).toContain("development");
    expect(selected).toContain("travel");
    expect(selected).not.toContain("shopping");
    expect(fetchModel).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.001, promptTokens: 200 })
    );
  });

  test("keeps the best category when every independent match is uncertain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: {
            category: {
              choice: "label2",
              confidence: 0.2,
              probabilities: { label0: 0.25, label1: 0.35, label2: 0.4 },
              type: "choice",
            },
            label0: { noul: 0.3, type: "noul" },
            label1: { noul: 0.4, type: "noul" },
            label2: { noul: 0.5, type: "noul" },
          },
          usage: { cost: 0.001, input_tokens: 200, output_tokens: 10 },
        })
      )
    );
    const selected = await classifyMailMessage({
      labels,
      message: { id: "message" },
    });
    expect(selected).toHaveLength(1);
    expect(selected).toContain("shopping");
  });

  test("retains overlapping matches even when all available labels apply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: {
            category: {
              choice: "label0",
              confidence: 0.3,
              probabilities: { label0: 0.6, label1: 0.4 },
              type: "choice",
            },
            label0: { noul: 0.95, type: "noul" },
            label1: { noul: 0.85, type: "noul" },
          },
          usage: { cost: 0.001, input_tokens: 200, output_tokens: 10 },
        })
      )
    );
    const selected = await classifyMailMessage({
      labels: labels.slice(0, 2),
      message: { id: "message" },
    });
    expect(selected).toHaveLength(2);
    expect(selected).toContain("development");
    expect(selected).toContain("travel");
  });

  test("refuses a category outside the mailbox's labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: {
            category: {
              choice: "label99",
              confidence: 0.95,
              probabilities: { label99: 1 },
              type: "choice",
            },
          },
          usage: { cost: 0.001, input_tokens: 200, output_tokens: 10 },
        })
      )
    );
    await expect(
      classifyMailMessage({ labels, message: { id: "message" } })
    ).rejects.toThrow(/unknown label/u);
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
