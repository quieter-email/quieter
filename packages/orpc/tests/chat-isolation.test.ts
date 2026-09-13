import type * as DatabaseClientModule from "@quieter/database/client";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createAiChatResponse } from "../src/chat/service";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

// This fake implements only the database operations exercised by the test.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(mocks.query);
  return {
    ...actual,
    db: { select: database.select.bind(database) },
  };
});

vi.mock(import("../src/ai-access"), () => ({
  assertCanUseAi: vi.fn<() => Promise<void>>(),
}));
vi.mock(import("../src/mailbox/service"), async () => {
  const { getMailboxCapabilities } = await import("@quieter/mail/data-plane");
  return {
    assertAccessibleMailbox: vi
      .fn<typeof assertAccessibleMailbox>()
      .mockResolvedValue({
        capabilities: getMailboxCapabilities({ provider: "gmail" }),
        contentRevision: 0,
        id: "mailbox",
        organizationId: "team",
        provider: "gmail",
      }),
  };
});

const threadId = "b44942c1-aeeb-40a9-9da8-5c054e9f6030";
const foreground = {
  capabilities: ["navigate"],
  exchangeId: "d6c6b64a-1d5f-4406-9b1b-53a73ff6f41b",
  expiresAt: Date.now() + 60_000,
  generation: 1,
  policy: "ask",
  tabId: "tab-1",
};

describe("chat history isolation", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  test("rejects stale assistant resolutions even when tool call ids match", async () => {
    const part = {
      approval: { id: "approval" },
      input: {},
      state: "approval-requested",
      toolCallId: "tool",
      type: "tool-modify_mail",
    };
    mocks.query.mockResolvedValueOnce({
      rows: [[threadId, "mailbox", "Title", "user"]],
    });
    mocks.query.mockResolvedValueOnce({
      rows: [
        ["2026-09-05T00:00:00Z", "current-assistant", [part], 1, "assistant"],
      ],
    });

    await expect(
      createAiChatResponse({
        body: {
          category: "inbox",
          foreground,
          mailboxId: "mailbox",
          message: {
            id: "old-assistant",
            parts: [
              {
                ...part,
                approval: { approved: true, id: "approval" },
                state: "approval-responded",
              },
            ],
            role: "assistant",
          },
          model: "openai/gpt-5.6-luna",
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId: "user",
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  test("hides a chat owned by another user during continuation", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [[threadId, "mailbox", "Title", "different-user"]],
    });

    await expect(
      createAiChatResponse({
        body: {
          category: "inbox",
          foreground,
          mailboxId: "mailbox",
          message: {
            id: "assistant",
            parts: [
              {
                approval: { approved: true, id: "approval" },
                input: {},
                state: "approval-responded",
                toolCallId: "tool",
                type: "tool-modify_mail",
              },
            ],
            role: "assistant",
          },
          model: "openai/gpt-5.6-luna",
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId: "user",
      })
    ).rejects.toMatchObject({ message: "Chat not found.", status: 404 });
  });

  test("returns chat not found when continuing a nonexistent chat", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      createAiChatResponse({
        body: {
          category: "inbox",
          foreground,
          mailboxId: "mailbox",
          message: {
            id: "assistant",
            parts: [
              {
                approval: { approved: true, id: "approval" },
                input: {},
                state: "approval-responded",
                toolCallId: "tool",
                type: "tool-modify_mail",
              },
            ],
            role: "assistant",
          },
          model: "openai/gpt-5.6-luna",
          threadId,
          trigger: "submit-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId: "user",
      })
    ).rejects.toMatchObject({ message: "Chat not found.", status: 404 });
  });
});
