import { describe, expect, test } from "bun:test";
import {
  extractListUnsubscribeTargets,
  getGmailMessageCount,
  listGmailMessageIds,
  listGmailAddedMessageHistoryPage,
  listMessagesWithDetails,
  refreshMailboxMessages,
  stopGmailWatch,
  watchGmailMailbox,
} from "../src/service";

const createBatchResponse = (boundary: string, bodies: readonly unknown[]) => {
  return [
    ...bodies.map((body) =>
      [
        `--${boundary}`,
        "Content-Type: application/http",
        "",
        "HTTP/1.1 200 OK",
        "Content-Type: application/json",
        "",
        JSON.stringify(body),
      ].join("\r\n"),
    ),
    `--${boundary}--`,
    "",
  ].join("\r\n");
};

const getBatchRequestCount = (
  body: BodyInit | null | undefined,
  resource: "messages" | "threads",
) => {
  return String(body).match(new RegExp(`/gmail/v1/users/me/${resource}/`, "g"))?.length ?? 0;
};

describe("extractListUnsubscribeTargets", () => {
  test("extracts mailto and url targets", () => {
    expect(
      extractListUnsubscribeTargets(
        "<https://example.com/unsubscribe?id=123>, <mailto:list@example.com?subject=unsubscribe>",
      ),
    ).toEqual({
      mailto: "mailto:list@example.com?subject=unsubscribe",
      url: "https://example.com/unsubscribe?id=123",
    });
  });

  test("keeps the first valid target for each supported scheme", () => {
    expect(
      extractListUnsubscribeTargets(
        "<mailto:first@example.com>, <mailto:second@example.com>, <https://example.com/first>, <https://example.com/second>",
      ),
    ).toEqual({
      mailto: "mailto:first@example.com",
      url: "https://example.com/first",
    });
  });

  test("ignores unsupported and invalid targets", () => {
    expect(
      extractListUnsubscribeTargets(
        "<ftp://example.com/unsubscribe>, <javascript:alert(1)>, <mailto:>, <https://example.com/unsubscribe>",
      ),
    ).toEqual({
      mailto: undefined,
      url: "https://example.com/unsubscribe",
    });
  });
});

describe("refreshMailboxMessages", () => {
  test("caps requests, filters messages outside the mailbox, and includes thread counts", async () => {
    const originalFetch = globalThis.fetch;
    const calls: RequestInit[] = [];

    globalThis.fetch = async (_input, init) => {
      calls.push(init ?? {});
      const body = String(init?.body);

      if (body.includes("/gmail/v1/users/me/messages/")) {
        const messageCount = getBatchRequestCount(init?.body, "messages");
        return new Response(
          createBatchResponse(
            "message_boundary",
            Array.from({ length: messageCount }, (_, index) => ({
              id: `message-${index}`,
              threadId: `thread-${index}`,
              labelIds: index === 1 ? ["TRASH"] : ["INBOX"],
              payload: {
                headers: [
                  { name: "From", value: `Sender ${index} <sender-${index}@example.com>` },
                  { name: "Subject", value: `Subject ${index}` },
                ],
              },
            })),
          ),
          {
            headers: {
              "content-type": "multipart/mixed; boundary=message_boundary",
            },
          },
        );
      }

      const threadCount = getBatchRequestCount(init?.body, "threads");
      return new Response(
        createBatchResponse(
          "thread_boundary",
          Array.from({ length: threadCount }, (_, index) => ({
            id: `thread-${index}`,
            messages: [
              { id: `thread-message-${index}-a`, threadId: `thread-${index}` },
              { id: `thread-message-${index}-b`, threadId: `thread-${index}` },
            ],
          })),
        ),
        {
          headers: {
            "content-type": "multipart/mixed; boundary=thread_boundary",
          },
        },
      );
    };

    try {
      const result = await refreshMailboxMessages("token", {
        mailbox: "inbox",
        messageIds: Array.from({ length: 30 }, (_, index) => `message-${index}`),
      });

      expect(getBatchRequestCount(calls[0].body, "messages")).toBe(25);
      expect(result.removedMessageIds).toEqual(["message-1"]);
      expect(result.updatedMessages).toHaveLength(24);
      expect(result.updatedMessages[0]).toMatchObject({
        id: "message-0",
        labelIds: ["INBOX"],
        subject: "Subject 0",
        threadMessageCount: 2,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getGmailMessageCount", () => {
  test("counts exact results under the configured cap instead of trusting stale estimates", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({
        messages: [
          { id: "message-1", threadId: "thread-1" },
          { id: "message-2", threadId: "thread-2" },
          { id: "message-3", threadId: "thread-3" },
        ],
        resultSizeEstimate: 201,
      });
    };

    try {
      expect(
        await getGmailMessageCount("token", {
          accurateUpTo: 99,
          mailbox: "unread",
          query: "-in:spam -in:trash",
        }),
      ).toBe(3);

      const searchParams = new URL(requestedUrl).searchParams;
      expect(searchParams.get("labelIds")).toBe("UNREAD");
      expect(searchParams.get("q")).toBe("-in:spam -in:trash");
      expect(searchParams.get("maxResults")).toBe("100");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deduplicates Gmail threads for thread-based unread counts", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () =>
      Response.json({
        messages: [
          { id: "message-1", threadId: "thread-1" },
          { id: "message-2", threadId: "thread-1" },
          { id: "message-3", threadId: "thread-2" },
        ],
        resultSizeEstimate: 3,
      });

    try {
      expect(
        await getGmailMessageCount("token", {
          accurateUpTo: 99,
          countBy: "threads",
          mailbox: "unread",
          query: "-in:spam -in:trash",
        }),
      ).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("listGmailMessageIds", () => {
  test("excludes spam and trash from the unread mailbox query", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({
        messages: [],
      });
    };

    try {
      await listGmailMessageIds("token", { mailbox: "unread" });

      const searchParams = new URL(requestedUrl).searchParams;
      expect(searchParams.get("labelIds")).toBe("UNREAD");
      expect(searchParams.get("q")).toBe("-in:spam -in:trash");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("listMessagesWithDetails", () => {
  test("filters spam and trash out of unread mailbox details", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/gmail/v1/users/me/messages") && !url.includes("/batch/")) {
        return Response.json({
          messages: [
            { id: "message-spam", threadId: "thread-spam" },
            { id: "message-trash", threadId: "thread-trash" },
            { id: "message-active", threadId: "thread-active" },
          ],
          resultSizeEstimate: 3,
        });
      }

      if (String(init?.body).includes("/gmail/v1/users/me/messages/")) {
        return new Response(
          createBatchResponse("message_boundary", [
            {
              id: "message-spam",
              threadId: "thread-spam",
              historyId: "10",
              labelIds: ["UNREAD", "SPAM"],
              payload: { headers: [{ name: "Subject", value: "Spam" }] },
            },
            {
              id: "message-trash",
              threadId: "thread-trash",
              historyId: "10",
              labelIds: ["UNREAD", "TRASH"],
              payload: { headers: [{ name: "Subject", value: "Trash" }] },
            },
            {
              id: "message-active",
              threadId: "thread-active",
              historyId: "10",
              labelIds: ["UNREAD"],
              payload: { headers: [{ name: "Subject", value: "Active" }] },
            },
          ]),
          {
            headers: {
              "content-type": "multipart/mixed; boundary=message_boundary",
            },
          },
        );
      }

      return new Response(
        createBatchResponse("thread_boundary", [
          {
            id: "thread-active",
            messages: [{ id: "message-active", threadId: "thread-active" }],
          },
        ]),
        {
          headers: {
            "content-type": "multipart/mixed; boundary=thread_boundary",
          },
        },
      );
    };

    try {
      const result = await listMessagesWithDetails("token", { mailbox: "unread" });

      expect(result.messages.map((message) => message.id)).toEqual(["message-active"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Gmail watch and history", () => {
  test("starts and stops a mailbox watch", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ body?: BodyInit | null; method?: string; url: string }> = [];

    globalThis.fetch = async (input, init) => {
      calls.push({
        body: init?.body,
        method: init?.method,
        url: String(input),
      });
      return calls.length === 1
        ? Response.json({
            expiration: "1780000000000",
            historyId: "123",
          })
        : new Response(null, { status: 204 });
    };

    try {
      const watch = await watchGmailMailbox("token", "projects/project/topics/gmail");
      await stopGmailWatch("token");

      expect(watch).toEqual({
        expiration: new Date(1_780_000_000_000),
        historyId: "123",
      });
      expect(calls[0]).toMatchObject({
        method: "POST",
        url: "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      });
      expect(JSON.parse(String(calls[0]?.body))).toEqual({
        topicName: "projects/project/topics/gmail",
      });
      expect(calls[1]).toMatchObject({
        method: "POST",
        url: "https://gmail.googleapis.com/gmail/v1/users/me/stop",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns a resumable cursor for a paginated added-message history page", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return Response.json({
        history: [
          {
            id: "101",
            messagesAdded: [{ message: { id: "message-1", threadId: "thread-1" } }],
          },
          {
            id: "105",
            messagesAdded: [
              { message: { id: "message-1", threadId: "thread-1" } },
              { message: { id: "message-2", threadId: "thread-2" } },
            ],
          },
        ],
        historyId: "110",
        nextPageToken: "next",
      });
    };

    try {
      expect(
        await listGmailAddedMessageHistoryPage("token", {
          pageToken: "page",
          startHistoryId: "100",
        }),
      ).toEqual({
        hasMore: true,
        historyExpired: false,
        historyId: "110",
        messageIds: ["message-1", "message-2"],
        nextPageToken: "next",
      });
      expect(new URL(requestedUrl).searchParams.get("pageToken")).toBe("page");
      expect(new URL(requestedUrl).searchParams.get("startHistoryId")).toBe("100");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("marks an expired Gmail history cursor for recovery", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () =>
      Response.json(
        {
          error: {
            code: 404,
            message: "Requested entity was not found.",
            status: "NOT_FOUND",
          },
        },
        { status: 404 },
      );

    try {
      expect(
        await listGmailAddedMessageHistoryPage("token", {
          startHistoryId: "expired",
        }),
      ).toEqual({
        hasMore: false,
        historyExpired: true,
        historyId: "expired",
        messageIds: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
