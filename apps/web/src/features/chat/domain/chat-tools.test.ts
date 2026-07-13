import { describe, expect, test } from "vite-plus/test";
import { parseToolResult } from "./chat-tools";

describe("parseToolResult", () => {
  test("parses structured Gmail search results", () => {
    const result = parseToolResult(
      "search_gmail",
      JSON.stringify({
        category: "inbox",
        fetchedAt: "2026-07-13T12:00:00.000Z",
        messages: [],
        query: "is:unread",
        status: "success",
      }),
    );

    expect(result).toEqual({
      data: {
        category: "inbox",
        fetchedAt: "2026-07-13T12:00:00.000Z",
        messages: [],
        query: "is:unread",
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
          attachments: [],
          body: "Hello",
          bodyTruncated: false,
          category: "inbox",
          fetchedAt: "2026-07-13T12:00:00.000Z",
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
          fetchedAt: "2026-07-13T12:00:00.000Z",
          labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
          status: "success",
        }),
      ),
    ).toMatchObject({ kind: "gmail-labels" });
  });

  test("parses batch Gmail message results", () => {
    expect(
      parseToolResult(
        "read_gmail_messages",
        JSON.stringify({
          failed: [],
          fetchedAt: "2026-07-13T12:00:00.000Z",
          messages: [
            {
              attachmentCount: 0,
              attachments: [],
              body: "Hello",
              bodyTruncated: false,
              category: "inbox",
              fetchedAt: "2026-07-13T12:00:00.000Z",
              id: "message-1",
              status: "success",
              threadId: "thread-1",
            },
          ],
          status: "success",
        }),
      ),
    ).toMatchObject({ kind: "gmail-messages" });
  });

  test("parses Gmail attachment results", () => {
    expect(
      parseToolResult("read_gmail_attachment", {
        attachmentId: "attachment-1",
        content: "status,owner\nready,Ada",
        contentTruncated: false,
        fetchedAt: "2026-07-13T12:00:00.000Z",
        fileName: "status.csv",
        messageId: "message-1",
        mimeType: "text/csv",
        size: 22,
        status: "success",
      }),
    ).toMatchObject({ kind: "gmail-attachment" });
  });

  test("falls back to an unknown result for malformed output", () => {
    expect(parseToolResult("get_mailbox_overview", "not-json")).toEqual({
      kind: "unknown",
      value: null,
    });
  });
});
