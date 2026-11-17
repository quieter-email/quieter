import { ORPCError } from "@orpc/server";
import { asSchema } from "ai";
import { assert, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createSemanticMailChatTools } from "../src/chat/mail-tools";
import { requestSemanticIndex } from "../src/semantic-index-request";
import { searchSemanticHistory } from "../src/semantic-search";

vi.mock(import("../src/semantic-index-request"), () => ({
  requestSemanticIndex: vi.fn<typeof requestSemanticIndex>(),
}));

vi.mock(import("../src/semantic-search"), () => ({
  searchSemanticHistory: vi.fn<typeof searchSemanticHistory>(),
}));

const invokeTool = async (
  tools: ReturnType<typeof createSemanticMailChatTools>,
  value: unknown,
  signal?: AbortSignal
) => {
  const tool = tools.search_semantic_mail;
  const { validate } = asSchema(tool.inputSchema);
  if (validate === undefined) {
    throw new Error("Expected semantic mail input validation.");
  }
  const parsed = await validate(value);
  if (!parsed.success) {
    throw parsed.error;
  }
  return await tool.execute(parsed.value, {
    abortSignal: signal,
    context: {},
    messages: [],
    toolCallId: "semantic-mail-call",
  });
};

describe("foreground semantic mail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requestSemanticIndex).mockResolvedValue();
    vi.mocked(searchSemanticHistory).mockResolvedValue({
      coverage: { complete: false, indexedSources: 1, totalSources: 2 },
      items: [],
      retainedOnly: true,
    });
  });

  test.each(["mailboxId", "userId"])(
    "rejects an injected %s before accessing retained content",
    async (field) => {
      const tools = createSemanticMailChatTools({
        mailboxId: "authorized-mailbox",
        userId: "acting-user",
      });

      await expect(
        invokeTool(tools, { [field]: "other-scope", query: "contract renewal" })
      ).rejects.toThrow(/unrecognized/iu);

      expect(requestSemanticIndex).not.toHaveBeenCalled();
      expect(searchSemanticHistory).not.toHaveBeenCalled();
    }
  );

  test("binds retained preparation and mail retrieval to the authenticated scope", async () => {
    vi.mocked(searchSemanticHistory).mockResolvedValue({
      coverage: { complete: false, indexedSources: 1, totalSources: 2 },
      items: [
        {
          kind: "mail",
          messageId: "193a42bcb7607d95",
          snippet: "The agreement renews next month.",
          threadId: "193a42bcb7607d94",
          title: "Contract & mailboxId=other#renewal",
          updatedAt: "2026-11-15T12:00:00.000Z",
        },
        {
          chatId: "private-chat",
          kind: "chat",
          messageId: "private-chat-message",
          snippet: "Private conversation text.",
          title: "Private conversation",
          updatedAt: "2026-11-15T12:00:00.000Z",
        },
      ],
      retainedOnly: true,
    });
    const tools = createSemanticMailChatTools({
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    const controller = new AbortController();

    const result = await invokeTool(
      tools,
      { query: "  contract renewal  " },
      controller.signal
    );

    expect(requestSemanticIndex).toHaveBeenCalledWith({
      kind: "mail",
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    expect(searchSemanticHistory).toHaveBeenCalledWith({
      kind: "mail",
      mailboxId: "authorized-mailbox",
      query: "contract renewal",
      signal: controller.signal,
      userId: "acting-user",
    });
    expect(result).toMatchObject({
      coverage: { complete: false },
      retainedOnly: true,
      status: "success",
    });
    assert("messages" in result);
    expect(result.messages).toHaveLength(1);
    const [message] = result.messages;
    assert(message !== undefined);
    const reference = new URL(message.reference, "https://quieter.invalid");
    expect([...reference.searchParams.keys()].toSorted()).toStrictEqual([
      "messageId",
      "subject",
      "threadId",
    ]);
    expect(reference.searchParams.get("messageId")).toBe("193a42bcb7607d95");
    expect(reference.searchParams.get("threadId")).toBe("193a42bcb7607d94");
    expect(reference.searchParams.get("subject")).toBe(
      "Contract & mailboxId=other#renewal"
    );
    expect(reference.hash).toBe("");
  });

  test("does no preparation or retrieval for an already cancelled turn", async () => {
    const tools = createSemanticMailChatTools({
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      invokeTool(tools, { query: "contract renewal" }, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(requestSemanticIndex).not.toHaveBeenCalled();
    expect(searchSemanticHistory).not.toHaveBeenCalled();
  });

  test("stops before retrieval when cancellation arrives during preparation", async () => {
    const tools = createSemanticMailChatTools({
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    const controller = new AbortController();
    vi.mocked(requestSemanticIndex).mockImplementationOnce(async () => {
      await Promise.resolve();
      controller.abort();
    });

    await expect(
      invokeTool(tools, { query: "contract renewal" }, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(searchSemanticHistory).not.toHaveBeenCalled();
  });

  test("does not publish successful results after cancellation during retrieval", async () => {
    const tools = createSemanticMailChatTools({
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    const controller = new AbortController();
    vi.mocked(searchSemanticHistory).mockImplementationOnce(async () => {
      await Promise.resolve();
      controller.abort();
      return {
        coverage: { complete: true, indexedSources: 0, totalSources: 0 },
        items: [],
        retainedOnly: false,
      };
    });

    await expect(
      invokeTool(tools, { query: "contract renewal" }, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("propagates denied preparation access without starting retrieval", async () => {
    const tools = createSemanticMailChatTools({
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    const denied = new ORPCError("FORBIDDEN");
    vi.mocked(requestSemanticIndex).mockRejectedValueOnce(denied);

    await expect(invokeTool(tools, { query: "contract renewal" })).rejects.toBe(
      denied
    );

    expect(searchSemanticHistory).not.toHaveBeenCalled();
  });

  test("propagates revoked retrieval access and permits a later authorized retry", async () => {
    const tools = createSemanticMailChatTools({
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    const revoked = new ORPCError("FORBIDDEN");
    vi.mocked(searchSemanticHistory).mockRejectedValueOnce(revoked);

    await expect(invokeTool(tools, { query: "contract renewal" })).rejects.toBe(
      revoked
    );
    await expect(
      invokeTool(tools, { query: "contract renewal" })
    ).resolves.toMatchObject({ status: "success" });
  });

  test("fails a provider error without retaining a successful result", async () => {
    const tools = createSemanticMailChatTools({
      mailboxId: "authorized-mailbox",
      userId: "acting-user",
    });
    await invokeTool(tools, { query: "contract renewal" });
    const failure = new Error("Search unavailable.");
    vi.mocked(searchSemanticHistory).mockRejectedValueOnce(failure);

    await expect(invokeTool(tools, { query: "contract renewal" })).rejects.toBe(
      failure
    );
  });
});
