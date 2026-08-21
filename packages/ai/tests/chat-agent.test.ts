import { describe, expect, test, vi } from "vite-plus/test";

import {
  aiMemoryToolDef,
  composeEmailToolDef,
  createComposeEmailServerTool,
  createGmailSearchServerTool,
  gmailSearchToolDef,
  googleCalendarCreateEventToolDef,
  modifyMailToolDef,
} from "../src/chat-agent";
import type {
  ComposeEmailToolsContext,
  GmailReadOnlyToolsContext,
} from "../src/chat-agent";
import { normalizeChatTitle } from "../src/generate-chat-title";
import { OPENROUTER_TRANSCRIPTION_MODEL } from "../src/transcription-format";

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

  test("defaults an omitted compose action to send and delegates parsed input", async () => {
    const composeEmail = vi.fn<ComposeEmailToolsContext["composeEmail"]>(
      async () =>
        await Promise.resolve({
          status: "sent",
          subject: "Hello",
          to: "a@example.com",
        })
    );
    const tool = createComposeEmailServerTool({ composeEmail });

    if (tool.execute === undefined) {
      throw new Error("Expected compose email tool execute handler");
    }

    await tool.execute({
      bodyText: "Hi",
      subject: "Hello",
      to: "a@example.com",
    });

    expect(composeEmail).toHaveBeenCalledWith({
      action: "send",
      bcc: "",
      bodyText: "Hi",
      cc: "",
      subject: "Hello",
      to: "a@example.com",
    });
  });

  test("keeps an explicit compose draft action", async () => {
    const composeEmail = vi.fn<ComposeEmailToolsContext["composeEmail"]>(
      async () =>
        await Promise.resolve({
          draftId: "draft-1",
          status: "draft_saved",
          subject: "Hello",
          to: "a@example.com",
        })
    );
    const tool = createComposeEmailServerTool({ composeEmail });

    if (tool.execute === undefined) {
      throw new Error("Expected compose email tool execute handler");
    }

    await tool.execute({
      action: "save_draft",
      bodyText: "Hi",
      subject: "Hello",
      to: "a@example.com",
    });

    expect(composeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ action: "save_draft" })
    );
  });

  test("requires approval for state-changing tools", () => {
    expect(modifyMailToolDef.needsApproval).toBeTruthy();
    expect(googleCalendarCreateEventToolDef.needsApproval).toBeTruthy();
    expect(aiMemoryToolDef.needsApproval).toBeTruthy();
    expect(composeEmailToolDef.needsApproval).toBeTruthy();
  });

  test("uses the proven transcription model", () => {
    expect(OPENROUTER_TRANSCRIPTION_MODEL).toBe("microsoft/mai-transcribe-1.5");
  });
});
