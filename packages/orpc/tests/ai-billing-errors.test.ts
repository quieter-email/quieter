import { call, ORPCError } from "@orpc/server";
import type { generateOpenRouterTranscription } from "@quieter/ai/openrouter-transcription";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
import { db } from "@quieter/database/client";
import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { loadAiAgentContext } from "../src/ai-memory";
import type * as AiMemoryModule from "../src/ai-memory";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import { aiRouter } from "../src/routers/ai";
import { chatRouter } from "../src/routers/chat";

const mocks = vi.hoisted(() => ({
  format: vi.fn<() => Promise<string>>(),
  parse: vi.fn<() => Promise<{ filters: []; freeText: string }>>(),
  report: vi.fn<() => void>(),
  transcribe: vi.fn<typeof generateOpenRouterTranscription>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the protected procedure identity contract is needed.
vi.mock("@quieter/auth/session", () => ({
  getSessionWithOrganization: vi
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({
      session: { id: "session" },
      user: { email: "test@example.invalid", id: "user", name: "Test" },
    }),
}));
vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: vi
    .fn<typeof assertAccessibleMailbox>()
    .mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "gmail" }),
      contentRevision: 0,
      id: "mailbox",
      organizationId: "organization",
      provider: "gmail",
    }),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Keep the generic memory loader mocked at the router boundary.
vi.mock("../src/ai-memory", async (original) => ({
  ...(await original<typeof AiMemoryModule>()),
  loadAiAgentContext: vi
    .fn<typeof loadAiAgentContext>()
    .mockResolvedValue({ instructions: null, memory: null }),
}));
vi.mock(import("@quieter/billing/ai-reservation"), () => ({
  createMailboxAiBillingContext: vi
    .fn<typeof createMailboxAiBillingContext>()
    .mockResolvedValue({
      account: null,
      admittedAt: new Date(),
      groupId: "fixture",
      kind: "team",
      organizationId: "organization",
      usageKind: "aiChat",
    }),
}));
vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: mocks.report,
}));
vi.mock(import("@quieter/ai/parse-mail-search"), async (original) => ({
  ...(await original()),
  parseMailSearchWithAi: mocks.parse,
}));
vi.mock(import("@quieter/ai/openrouter-transcription"), () => ({
  generateOpenRouterTranscription: mocks.transcribe,
}));
vi.mock(import("@quieter/ai/format-transcribed-email"), () => ({
  formatTranscribedEmail: mocks.format,
}));

const context = { db, headers: new Headers() };
const audio = {
  audioBase64: "YQ==",
  durationMs: 1000,
  format: "wav" as const,
  mailboxId: "mailbox",
};

describe("foreground AI billing error propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transcribe.mockResolvedValue({
      text: "Hello",
      usage: {
        completionTokens: 0,
        cost: undefined,
        durationSeconds: undefined,
        promptTokens: 0,
      },
    });
    mocks.parse.mockResolvedValue({ filters: [], freeText: "hello" });
  });

  test.each(["search", "transcription", "formatting"] as const)(
    "%s preserves actionable admission errors without unexpected reporting",
    async (path) => {
      const error = new ORPCError("FORBIDDEN", {
        message: "Wait for the current request.",
      });
      if (path === "search") {
        mocks.parse.mockRejectedValue(error);
      } else if (path === "transcription") {
        mocks.transcribe.mockRejectedValue(error);
      } else {
        mocks.format.mockRejectedValue(error);
      }
      const request =
        path === "search"
          ? call(
              aiRouter.interpretSearchQuery,
              { mailboxId: "mailbox", query: "hello" },
              { context }
            )
          : call(
              chatRouter.transcribeAudio,
              { ...audio, mode: path === "formatting" ? "email" : "chat" },
              { context }
            );
      await expect(request).rejects.toMatchObject({
        code: error.code,
        message: error.message,
        status: error.status,
      });
      expect(mocks.report).not.toHaveBeenCalled();
    }
  );

  test("successful search and transcription retain their results", async () => {
    await expect(
      call(
        aiRouter.interpretSearchQuery,
        { mailboxId: "mailbox", query: "hello" },
        { context }
      )
    ).resolves.toMatchObject({ text: "hello" });
    await expect(
      call(chatRouter.transcribeAudio, audio, { context })
    ).resolves.toMatchObject({ text: "Hello" });
  });

  test.each(["search", "transcription"] as const)(
    "%s reports unexpected provider failures",
    async (path) => {
      const error = new Error("Provider unavailable");
      mocks.parse.mockRejectedValue(error);
      mocks.transcribe.mockRejectedValue(error);
      const request =
        path === "search"
          ? call(
              aiRouter.interpretSearchQuery,
              { mailboxId: "mailbox", query: "hello" },
              { context }
            )
          : call(chatRouter.transcribeAudio, audio, { context });
      await expect(request).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      expect(mocks.report).toHaveBeenCalledWith(error, expect.anything());
    }
  );
});
