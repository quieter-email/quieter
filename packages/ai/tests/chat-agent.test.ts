import { describe, expect, test, vi } from "vite-plus/test";
import { createGmailSearchServerTool, gmailSearchToolDef } from "../src/chat-agent";
import { OPENROUTER_TRANSCRIPTION_MODEL } from "../src/transcription-format";

describe("chat tools", () => {
  test("accepts and drops an empty first-page search token", async () => {
    const searchGmail = vi.fn(async () => ({
      category: "inbox" as const,
      fetchedAt: "2026-07-15T12:00:00.000Z",
      messages: [],
      query: "from:(tu-berlin.de)",
      status: "success" as const,
    }));
    const parsed = gmailSearchToolDef.inputSchema!.safeParse({
      maxResults: 10,
      pageToken: "",
      query: "from:(tu-berlin.de)",
    });

    expect(parsed.success).toBe(true);

    const tool = createGmailSearchServerTool({
      category: "inbox",
      getMailboxOverview: vi.fn(),
      listGmailLabels: vi.fn(),
      modifyMail: vi.fn(),
      readGmailAttachment: vi.fn(),
      readGmailMessage: vi.fn(),
      readGmailMessages: vi.fn(),
      readGmailThread: vi.fn(),
      searchGmail,
    });

    await tool.execute!(parsed.data!);

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
