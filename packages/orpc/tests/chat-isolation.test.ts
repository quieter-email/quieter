import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createAiChatResponse } from "../src/chat/service";
import type { assertAccessibleMailbox } from "../src/mailbox/service";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const actual = await importOriginal();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(mocks.query);
  return {
    ...actual,
    db: Object.assign(actual.db, { select: database.select.bind(database) }),
  };
});

vi.mock(import("../src/chat/access"), () => ({
  assertAiChatCredits: vi.fn<() => Promise<void>>(),
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

describe("chat history isolation", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  test.each([
    ["another-mailbox", "user"],
    ["mailbox", "another-user"],
  ])(
    "rejects retries for chat owned by %s and %s before loading messages",
    async (mailboxId, userId) => {
      mocks.query.mockResolvedValueOnce({
        rows: [[threadId, mailboxId, "Private title", userId]],
      });

      await expect(
        createAiChatResponse({
          body: {
            category: "inbox",
            mailboxId: "mailbox",
            message: null,
            model: "openai/gpt-5.6-luna",
            threadId,
            trigger: "regenerate-message",
          },
          request: new Request("https://example.test/api/chat"),
          userId: "user",
        })
      ).rejects.toMatchObject({ status: 404 });
      expect(mocks.query).toHaveBeenCalledOnce();
      expect(mocks.query.mock.calls[0]?.[0]).not.toContain('"chat_message"');
    }
  );

  test("rejects a retry for a nonexistent chat before loading messages", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      createAiChatResponse({
        body: {
          category: "inbox",
          mailboxId: "mailbox",
          message: null,
          model: "openai/gpt-5.6-luna",
          threadId,
          trigger: "regenerate-message",
        },
        request: new Request("https://example.test/api/chat"),
        userId: "user",
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.query).toHaveBeenCalledOnce();
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
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
