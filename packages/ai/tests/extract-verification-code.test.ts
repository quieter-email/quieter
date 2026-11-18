import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { AiUsageReport } from "../src/chat-usage";
import { extractMailVerificationCode } from "../src/extract-verification-code";

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

const usage = { cost: 0.001, input_tokens: 200, output_tokens: 0 };

describe("mail verification code extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reads the code, validity duration and service from typed fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: {
            code: { type: "text", value: "482193" },
            expiresInSeconds: { type: "number", value: 600 },
            service: { type: "text", value: "Example" },
          },
          usage,
        })
      )
    );
    const onUsage = vi.fn<(usage: AiUsageReport) => void>();
    await expect(
      extractMailVerificationCode({
        billing,
        message: { bodyText: "Your code is 482193.", id: "message" },
        onUsage,
      })
    ).resolves.toStrictEqual({
      code: "482193",
      expiresInSeconds: 600,
      service: "Example",
    });
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ costUsd: 0.001, promptTokens: 200 })
    );
  });

  test("returns a null code for an answer that is not a temporary code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          answers: {
            code: {
              type: "text",
              value: `signed.${"synthetic".repeat(20)}.token`,
            },
            expiresInSeconds: { type: "number", value: null },
            service: { type: "text", value: "Example" },
          },
          usage,
        })
      )
    );
    await expect(
      extractMailVerificationCode({
        billing,
        message: { bodyText: "Sign in with the link.", id: "message" },
      })
    ).resolves.toStrictEqual({
      code: null,
      expiresInSeconds: null,
      service: "Example",
    });
  });

  test("fails closed when the answer shape is incomplete", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ answers: {}, usage }))
    );
    await expect(
      extractMailVerificationCode({
        billing,
        message: { bodyText: "Your code is 482193.", id: "message" },
      })
    ).rejects.toThrow(/answers/u);
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
