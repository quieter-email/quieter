import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { defaultBackgroundModel } from "../src/chat-models";
import type { AiUsageReport } from "../src/chat-usage";
import { suggestReply } from "../src/suggest-reply";

const state = vi.hoisted(() => ({
  model: vi.fn<() => MockLanguageModelV4>(),
}));
vi.mock(import("../src/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: state.model,
}));

const useResponse = (output: {
  bodyText: string | null;
  reason: string | null;
  status: "suggested" | "not_needed";
}) => {
  state.model.mockReturnValue(
    new MockLanguageModelV4({
      doGenerate: {
        content: [{ text: JSON.stringify(output), type: "text" }],
        finishReason: { raw: undefined, unified: "stop" },
        providerMetadata: { openrouter: { usage: { cost: 0.01 } } },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
          outputTokens: { reasoning: 0, text: 5, total: 5 },
        },
        warnings: [],
      },
    })
  );
};

const input = {
  memoryContext: null,
  messages: [
    {
      bodyText: "Can you clarify which report?",
      date: "",
      from: "sender@example.com",
      id: "message",
      outgoing: false,
      subject: "Report",
      to: "user@example.com",
    },
  ],
  model: defaultBackgroundModel,
  replyToMessageId: "message",
};

describe("reply suggestion structured output", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test.each([null, "", "  "])(
    "rejects unusable draft output while accounting for generation",
    async (bodyText) => {
      useResponse({ bodyText, reason: null, status: "suggested" });
      const onUsage = vi.fn<(usage: AiUsageReport) => void>();
      await expect(suggestReply({ ...input, onUsage })).rejects.toThrow(
        /bodyText/u
      );
      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({ costUsd: 0.01 })
      );
    }
  );

  test("does not expose draft text for a no-reply-needed decision", async () => {
    useResponse({
      bodyText: "An unwanted draft",
      reason: "The conversation is already complete.",
      status: "not_needed",
    });
    const result = await suggestReply({
      ...input,
      onUsage: vi.fn<(usage: AiUsageReport) => void>(),
    });
    expect(result).toMatchObject({ status: "not_needed" });
    expect("bodyText" in result).toBeFalsy();
  });
});
