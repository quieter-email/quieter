import { asSchema } from "ai";
import { assert, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createMailReadChatTools } from "../src/chat/mail-tools";
import { queriesMailOperations } from "../src/mail/queries";
import type { requestSemanticIndex } from "../src/semantic-index-request";
import type { searchSemanticHistory } from "../src/semantic-search";

vi.mock(import("../src/mail/queries"), async (original) => {
  const actual = await original();
  return {
    queriesMailOperations: {
      ...actual.queriesMailOperations,
      getThread: vi.fn<typeof queriesMailOperations.getThread>(),
      listThreads: vi.fn<typeof queriesMailOperations.listThreads>(),
    },
  };
});

vi.mock(import("../src/semantic-index-request"), () => ({
  requestSemanticIndex: vi.fn<typeof requestSemanticIndex>(),
}));

vi.mock(import("../src/semantic-search"), () => ({
  searchSemanticHistory: vi.fn<typeof searchSemanticHistory>(),
}));

const invokeSearch = async (
  tools: ReturnType<typeof createMailReadChatTools>,
  value: unknown
) => {
  const search = tools.search_mail;
  assert(search !== undefined);
  assert(search.execute !== undefined);
  const { validate } = asSchema<unknown>(search.inputSchema);
  assert(validate !== undefined);
  const parsed = await validate(value);
  if (!parsed.success) {
    throw parsed.error;
  }
  const result: unknown = await search.execute(parsed.value, {
    context: {},
    messages: [],
    toolCallId: "mail-search-call",
  });
  return result;
};

describe("mail read chat tools", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(queriesMailOperations.listThreads).mockResolvedValue({
      messages: [],
      nextPageToken: "next-page",
    });
  });

  test("constructs the registry and searches the current category with pagination", async () => {
    const tools = createMailReadChatTools({
      category: "inbox",
      mailboxId: "current-mailbox",
      userId: "acting-user",
    });

    await expect(
      invokeSearch(tools, { pageToken: "previous-page", query: "renewal" })
    ).resolves.toMatchObject({ nextPageToken: "next-page", status: "success" });

    expect(
      vi.mocked(queriesMailOperations.listThreads).mock.calls[0]?.[0]
    ).toMatchObject({
      context: { userId: "acting-user" },
      input: {
        category: "inbox",
        mailboxId: "current-mailbox",
        pageToken: "previous-page",
        query: "renewal",
      },
    });
  });

  test("preserves explicit category and exact correspondent all-mail search", async () => {
    const tools = createMailReadChatTools({
      category: "inbox",
      mailboxId: "current-mailbox",
      userId: "acting-user",
    });

    await expect(
      invokeSearch(tools, {
        category: "sent",
        correspondentEmail: "Alex+Tag@EXAMPLE.TEST",
        maxResults: 25,
        pageToken: "history-page",
        query: "subject:agreement",
        scope: "all_mail",
      })
    ).resolves.toMatchObject({ status: "success" });

    expect(queriesMailOperations.listThreads).toHaveBeenCalledWith({
      context: { signal: undefined, userId: "acting-user" },
      input: {
        category: "sent",
        correspondentEmail: "alex+tag@example.test",
        mailboxId: "current-mailbox",
        maxResults: 25,
        pageToken: "history-page",
        query: "subject:agreement",
        scope: "all_mail",
      },
    });
  });

  test("rejects a correspondent selector without all-mail scope before querying", async () => {
    const tools = createMailReadChatTools({
      category: "inbox",
      mailboxId: "current-mailbox",
      userId: "acting-user",
    });

    await expect(
      invokeSearch(tools, { correspondentEmail: "alex@example.test" })
    ).rejects.toMatchObject({ issues: [{ code: "custom", path: ["scope"] }] });

    expect(queriesMailOperations.listThreads).not.toHaveBeenCalled();
  });
});
