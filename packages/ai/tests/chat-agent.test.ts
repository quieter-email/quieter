import { describe, expect, test, vi } from "vite-plus/test";

import {
  createGmailSearchServerTool,
  gmailSearchToolDef,
} from "../src/chat-agent";
import type { GmailReadOnlyToolsContext } from "../src/chat-agent";
import { OPENROUTER_TRANSCRIPTION_MODEL } from "../src/transcription-format";

describe("chat tools", () => {
  test("accepts and drops an empty first-page search token", async () => {
    const searchGmail = vi.fn<GmailReadOnlyToolsContext["searchGmail"]>(
      async () =>
        await Promise.resolve({
          category: "inbox",
          fetchedAt: "2026-07-15T12:00:00.000Z",
          messages: [],
          query: "from:(tu-berlin.de)",
          status: "success",
        })
    );
    const parsed = gmailSearchToolDef.inputSchema.safeParse({
      maxResults: 10,
      pageToken: "",
      query: "from:(tu-berlin.de)",
    });

    expect(parsed.success).toBeTruthy();
    if (!parsed.success) {
      throw new Error("Expected gmail search input to parse");
    }

    const tool = createGmailSearchServerTool({
      category: "inbox",
      getMailboxOverview:
        vi.fn<GmailReadOnlyToolsContext["getMailboxOverview"]>(),
      listGmailLabels: vi.fn<GmailReadOnlyToolsContext["listGmailLabels"]>(),
      readGmailAttachment:
        vi.fn<GmailReadOnlyToolsContext["readGmailAttachment"]>(),
      readGmailMessage: vi.fn<GmailReadOnlyToolsContext["readGmailMessage"]>(),
      readGmailMessages:
        vi.fn<GmailReadOnlyToolsContext["readGmailMessages"]>(),
      readGmailThread: vi.fn<GmailReadOnlyToolsContext["readGmailThread"]>(),
      searchGmail,
    });

    if (tool.execute === undefined) {
      throw new Error("Expected gmail search tool execute handler");
    }

    await tool.execute(parsed.data);

    expect(searchGmail).toHaveBeenCalledWith({
      maxResults: 10,
      pageToken: undefined,
      query: "from:(tu-berlin.de)",
    });
  });

  test("uses the proven transcription model", () => {
    expect(OPENROUTER_TRANSCRIPTION_MODEL).toBe("microsoft/mai-transcribe-1.5");
  });
});
