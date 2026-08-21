import { describe, expect, test, vi } from "vite-plus/test";

import {
  createComposeEmailChatTool,
  createGmailChatTools,
  gmailSearchResultSchema,
} from "../src/chat-agent";
import type { GmailToolsContext } from "../src/chat-agent";
import { normalizeChatTitle } from "../src/generate-chat-title";
import { OPENROUTER_TRANSCRIPTION_MODEL } from "../src/transcription-format";

const noopContext = (): GmailToolsContext => ({
  category: "inbox",
  getMailboxOverview: vi.fn<GmailToolsContext["getMailboxOverview"]>(),
  listGmailLabels: vi.fn<GmailToolsContext["listGmailLabels"]>(),
  modifyMail: vi.fn<GmailToolsContext["modifyMail"]>(),
  readGmailAttachment: vi.fn<GmailToolsContext["readGmailAttachment"]>(),
  readGmailMessage: vi.fn<GmailToolsContext["readGmailMessage"]>(),
  readGmailMessages: vi.fn<GmailToolsContext["readGmailMessages"]>(),
  readGmailThread: vi.fn<GmailToolsContext["readGmailThread"]>(),
  searchGmail: vi.fn<GmailToolsContext["searchGmail"]>(
    async () =>
      await Promise.resolve({
        category: "inbox",
        fetchedAt: "2026-07-15T12:00:00.000Z",
        messages: [],
        query: "from:(tu-berlin.de)",
        status: "success",
      })
  ),
});

describe("chat title normalization", () => {
  test("strips wrapping quotes, markdown, and trailing punctuation", () => {
    expect(normalizeChatTitle('  **"Sarah Launch Emails."**  ', "any")).toBe(
      "Sarah Launch Emails"
    );
  });

  test("collapses whitespace", () => {
    expect(normalizeChatTitle("Most\n Important   Message", "any")).toBe(
      "Most Important Message"
    );
  });

  test("drops foreign-script words when the request is plain ASCII", () => {
    expect(normalizeChatTitle("Greeting സന്ദ", "Hello")).toBe("Greeting");
  });

  test("strips the foreign-script tail of a mixed word", () => {
    expect(normalizeChatTitle("Greetingസന്ദ", "Hello")).toBe("Greeting");
  });

  test("keeps the request's own script", () => {
    expect(normalizeChatTitle("Nachricht an Sarah", "Schreib an Sarah")).toBe(
      "Nachricht an Sarah"
    );
    expect(normalizeChatTitle("സന്ദേശം", "എനിക്ക് അയയ്ക്കുക")).toBe("സന്ദേശം");
  });

  test("truncates long titles at a word boundary", () => {
    const title = normalizeChatTitle(
      "Find every single message that mentions the quarterly revenue reconciliation project",
      "any"
    );

    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith(" ")).toBeFalsy();
    expect(title).toBe(
      "Find every single message that mentions the quarterly revenue reconciliation"
    );
  });

  test("clips a title that has no word boundary to cut on", () => {
    expect(normalizeChatTitle("a".repeat(120), "any")).toBe("a".repeat(80));
  });

  test("returns an empty title when nothing usable survives", () => {
    expect(normalizeChatTitle('"????"', "Hello")).toBe("");
  });
});

describe("chat tools", () => {
  test("accepts and drops an empty first-page search token", async () => {
    const context = noopContext();
    const tools = createGmailChatTools(context);
    const tool = tools.search_gmail;

    if (tool === undefined || tool.execute === undefined) {
      throw new Error("Expected gmail search tool execute handler");
    }

    await tool.execute(
      {
        maxResults: 10,
        pageToken: "",
        query: "from:(tu-berlin.de)",
      },
      {
        abortSignal: undefined,
        context: undefined,
        messages: [],
        toolCallId: "call-1",
      }
    );

    expect(context.searchGmail).toHaveBeenCalledWith({
      maxResults: 10,
      pageToken: undefined,
      query: "from:(tu-berlin.de)",
      signal: undefined,
    });
  });

  test("reports a failed search through the tool's output schema", async () => {
    const context = noopContext();
    vi.mocked(context.searchGmail).mockRejectedValueOnce(
      new Error("The mailbox took too long to respond.")
    );
    const tools = createGmailChatTools(context);
    const tool = tools.search_gmail;

    if (tool === undefined || tool.execute === undefined) {
      throw new Error("Expected gmail search tool execute handler");
    }

    const result: unknown = await tool.execute(
      {
        maxResults: 10,
        pageToken: "",
        query: "from:(tu-berlin.de)",
      },
      {
        abortSignal: undefined,
        context: undefined,
        messages: [],
        toolCallId: "call-1",
      }
    );

    const parsed = gmailSearchResultSchema.safeParse(result);
    expect(parsed.success && parsed.data.status === "error").toBeTruthy();
  });

  test("compose proposals stay client-executed", () => {
    const tools = createComposeEmailChatTool();
    const tool = tools.compose_email;

    expect(tool).toBeDefined();
    expect(tool.execute).toBeUndefined();
  });

  test("uses the proven transcription model", () => {
    expect(OPENROUTER_TRANSCRIPTION_MODEL).toBe("microsoft/mai-transcribe-1.5");
  });
});
