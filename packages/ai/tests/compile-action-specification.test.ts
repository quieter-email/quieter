import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { defaultBackgroundModel } from "../src/chat-models";
import { compileActionSpecification } from "../src/compile-action-specification";

const state = vi.hoisted(() => ({ model: vi.fn<() => MockLanguageModelV4>() }));
vi.mock(import("../src/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: state.model,
}));

const document = () => ({
  connectors: [],
  instructions: "Summarize incoming mail.",
  mailboxId: "mailbox",
  permissions: [{ id: "read", operation: "read", scope: "mailbox" }],
  review: {
    assumptions: [],
    questions: [],
    summary: "Summarize incoming mail.",
  },
  sourceText: "Summarize incoming mail.",
  toolGrants: [
    { confirmation: "none", permissionId: "read", toolId: "mail.read_thread" },
  ],
  trigger: { kind: "mail_received" },
  version: 1,
});

describe("action model output boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("uses a provider-compatible union schema while preserving strict reference validation", async () => {
    const parsed = document();
    const model = new MockLanguageModelV4({
      // oxlint-disable-next-line eslint/require-await -- The model boundary keeps its asynchronous contract without network I/O.
      doGenerate: async (options) => {
        expect(JSON.stringify(options.responseFormat)).not.toContain('"oneOf"');
        return {
          content: [{ text: JSON.stringify(parsed), type: "text" }],
          finishReason: { raw: undefined, unified: "stop" },
          usage: {
            inputTokens: {
              cacheRead: 0,
              cacheWrite: 0,
              noCache: 10,
              total: 10,
            },
            outputTokens: { reasoning: 0, text: 10, total: 10 },
          },
          warnings: [],
        };
      },
    });
    state.model.mockReturnValue(model);
    const input = {
      abortSignal: AbortSignal.timeout(5000),
      model: defaultBackgroundModel,
      onUsage: vi.fn<() => void>(),
      prompt: "User prompt",
      system: "Parse the action",
    };
    await expect(compileActionSpecification(input)).resolves.toMatchObject({
      mailboxId: "mailbox",
      trigger: { kind: "mail_received" },
    });
    parsed.toolGrants[0].permissionId = "undeclared-permission";
    await expect(compileActionSpecification(input)).rejects.toThrow(
      /schema|match|output/iu
    );
  });
});
