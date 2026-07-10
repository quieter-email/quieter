import { describe, expect, test } from "vite-plus/test";
import { parseToolResult } from "./chat-tools";

describe("parseToolResult", () => {
  test("parses structured Gmail search results", () => {
    const result = parseToolResult(
      "search_gmail",
      JSON.stringify({
        category: "inbox",
        messages: [],
        query: "is:unread",
        status: "success",
      }),
    );

    expect(result).toEqual({
      data: {
        category: "inbox",
        messages: [],
        query: "is:unread",
        status: "success",
      },
      kind: "gmail-search",
    });
  });

  test("normalizes persisted search results from before structured statuses", () => {
    const result = parseToolResult(
      "search_gmail",
      JSON.stringify({
        category: "sent",
        messages: [],
        query: "from:me",
      }),
    );

    expect(result).toEqual({
      data: {
        category: "sent",
        messages: [],
        query: "from:me",
        status: "success",
      },
      kind: "gmail-search",
    });
  });

  test("preserves typed tool errors", () => {
    const result = parseToolResult(
      "read_gmail_thread",
      JSON.stringify({
        category: "inbox",
        error: "Thread not found.",
        status: "error",
        threadId: "thread-1",
      }),
    );

    expect(result).toEqual({
      data: {
        category: "inbox",
        error: "Thread not found.",
        status: "error",
        threadId: "thread-1",
      },
      kind: "gmail-thread",
    });
  });

  test("parses declined inline compose results", () => {
    const result = parseToolResult(
      "compose_email",
      JSON.stringify({
        status: "declined",
        subject: "Status update",
        to: "person@example.com",
      }),
    );

    expect(result).toEqual({
      data: {
        status: "declined",
        subject: "Status update",
        to: "person@example.com",
      },
      kind: "compose-email",
    });
  });

  test("parses resolved inline compose results", () => {
    const result = parseToolResult(
      "compose_email",
      JSON.stringify({
        messageId: "message-1",
        status: "sent",
        subject: "Status update",
        threadId: "thread-1",
        to: "person@example.com",
      }),
    );

    expect(result).toEqual({
      data: {
        messageId: "message-1",
        status: "sent",
        subject: "Status update",
        threadId: "thread-1",
        to: "person@example.com",
      },
      kind: "compose-email",
    });
  });

  test("parses modify mail results", () => {
    const result = parseToolResult(
      "modify_mail",
      JSON.stringify({
        action: "mark_read",
        category: "inbox",
        id: "thread-1",
        status: "success",
        target: "thread",
      }),
    );

    expect(result).toEqual({
      data: {
        action: "mark_read",
        category: "inbox",
        id: "thread-1",
        status: "success",
        target: "thread",
      },
      kind: "modify-mail",
    });
  });

  test("parses gmail message and label list results", () => {
    expect(
      parseToolResult(
        "read_gmail_message",
        JSON.stringify({
          attachmentCount: 0,
          body: "Hello",
          bodyTruncated: false,
          category: "inbox",
          id: "message-1",
          status: "success",
          subject: "Hello",
          threadId: "thread-1",
        }),
      ),
    ).toMatchObject({ kind: "gmail-message" });

    expect(
      parseToolResult(
        "list_gmail_labels",
        JSON.stringify({
          category: "inbox",
          labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
          status: "success",
        }),
      ),
    ).toMatchObject({ kind: "gmail-labels" });
  });

  test("falls back to an unknown result for malformed output", () => {
    expect(parseToolResult("get_mailbox_overview", "not-json")).toEqual({
      kind: "unknown",
      value: null,
    });
  });
});
