import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  classifyMailMessage,
  detectMailVerificationCode,
} from "../src/classify-gmail-message";

const billing: AiBillingContext = {
  account: null,
  admittedAt: new Date(),
  groupId: "test-operation",
  kind: "team",
  organizationId: "test-team",
  usageKind: "aiChat",
};

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
      classifyMailMessage({
        billing,
        labels,
        message: { id: "message" },
      })
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
      classifyMailMessage({
        billing,
        labels,
        message: { id: "message" },
      })
    ).rejects.toThrow(/incomplete/u);
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
      detectMailVerificationCode({
        billing,
        message: { id: "message" },
      })
    ).rejects.toThrow(/no decision/u);
  });
});

vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  recordAiCreditProviderGeneration: async () => {
    await Promise.resolve();
  },
  releaseAiCreditUsage: async () => {
    await Promise.resolve();
  },
  reserveAiCreditUsage: async () => await Promise.resolve(null),
  settleAiCreditUsage: async () => {
    await Promise.resolve();
  },
}));
