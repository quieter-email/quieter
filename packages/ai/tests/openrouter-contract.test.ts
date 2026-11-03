import type { AiBillingContext } from "@quieter/billing/ai-reservation";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { runStructuredGeneration } from "../src/generation";

vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: { ...actual.serverEnv, OPENROUTER_API_KEY: "fixture-key" },
  };
});

vi.mock(import("../src/billing"), () => ({
  createAiBillingMiddleware: () => ({ specificationVersion: "v4" }),
}));

const billing: AiBillingContext = {
  account: null,
  admittedAt: new Date(),
  groupId: "fixture-operation",
  kind: "team",
  organizationId: "fixture-team",
  usageKind: "aiChat",
};

describe("structured provider contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("requires schema-capable routing while preserving private routing", async () => {
    const fetchModel = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: { content: '{"value":42}', role: "assistant" },
          },
        ],
        created: 1,
        id: "fixture-response",
        model: "fixture-model",
        object: "chat.completion",
        usage: { completion_tokens: 5, prompt_tokens: 10, total_tokens: 15 },
      })
    );
    vi.stubGlobal("fetch", fetchModel);

    await expect(
      runStructuredGeneration({
        billing,
        maxOutputTokens: 100,
        prioritizeLatency: true,
        prompt: "Return a value.",
        schema: z.object({ value: z.number() }),
        system: "Return structured output.",
      })
    ).resolves.toMatchObject({ value: 42 });

    const request = z
      .object({
        provider: z.object({
          require_parameters: z.boolean(),
          zdr: z.boolean(),
        }),
        response_format: z.object({ type: z.literal("json_schema") }),
      })
      .parse(JSON.parse(z.string().parse(fetchModel.mock.calls[0]?.[1]?.body)));
    expect(request.provider.require_parameters).toBeTruthy();
    expect(request.provider.zdr).toBeTruthy();
  });
});
