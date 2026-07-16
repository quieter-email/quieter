import { describe, expect, test } from "vite-plus/test";
import {
  extractListUnsubscribeTargets,
  getGmailMessageCount,
  listGmailMessageIds,
  listGmailAddedMessageHistoryPage,
  listMessagesWithDetails,
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

const getRequestBody = (body: BodyInit | null | undefined) =>
  typeof body === "string" ? body : "";

const getRequestUrl = (input: RequestInfo | URL) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const setFetch = (fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
  Reflect.set(globalThis, "fetch", fetch);
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

describe("getGmailMessageCount", () => {
  test("counts exact results under the configured cap instead of trusting stale estimates", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    setFetch(async (input) => {
      requestedUrl = getRequestUrl(input);
      return Response.json({
        messages: [
          { id: "message-1", threadId: "thread-1" },
          { id: "message-2", threadId: "thread-2" },
          { id: "message-3", threadId: "thread-3" },
        ],
        resultSizeEstimate: 201,
      });
    });

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

    setFetch(async () =>
      Response.json({
        messages: [
          { id: "message-1", threadId: "thread-1" },
          { id: "message-2", threadId: "thread-1" },
          { id: "message-3", threadId: "thread-2" },
        ],
        resultSizeEstimate: 3,
      }),
    );

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

    setFetch(async (input) => {
      requestedUrl = getRequestUrl(input);
      return Response.json({
        messages: [],
      });
    });

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
  test("compiles Archive to Gmail system-category exclusions", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    setFetch(async (input) => {
      const url = getRequestUrl(input);
      if (url.includes("/profile")) {
        return Response.json({ emailAddress: "user@example.com", historyId: "10" });
      }
      requestedUrl = url;
      return Response.json({ threads: [], resultSizeEstimate: 0 });
    });

    try {
      const result = await listMessagesWithDetails("token", {
        mailbox: "archive",
        query: "is:archived from:alex@example.com",
      });
      const query = new URL(requestedUrl).searchParams.get("q");

      expect(result.messages).toEqual([]);
      expect(query).toContain("from:alex@example.com");
      expect(query).toContain("-in:inbox");
      expect(query).toContain("-in:sent");
      expect(query).toContain("-label:drafts");
      expect(query).not.toContain("is:archived");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("filters spam and trash out of unread mailbox details", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];

    setFetch(async (input, init) => {
      const url = getRequestUrl(input);
      const body = getRequestBody(init?.body);
      calls.push(`${url}\n${body}`);

      if (url.includes("/gmail/v1/users/me/threads") && !url.includes("/batch/")) {
        return Response.json({
          threads: [{ id: "thread-spam" }, { id: "thread-trash" }, { id: "thread-active" }],
          resultSizeEstimate: 3,
        });
      }

      if (url.includes("/gmail/v1/users/me/profile")) {
        return Response.json({ emailAddress: "user@example.com", historyId: "10" });
      }

      if (body.includes("/gmail/v1/users/me/threads/")) {
        return new Response(
          createBatchResponse("thread_boundary", [
            {
              id: "thread-spam",
              messages: [
                {
                  id: "message-spam",
                  threadId: "thread-spam",
                  historyId: "10",
                  labelIds: ["UNREAD", "SPAM"],
                  payload: { headers: [{ name: "Subject", value: "Spam" }] },
                },
              ],
            },
            {
              id: "thread-trash",
              messages: [
                {
                  id: "message-trash",
                  threadId: "thread-trash",
                  historyId: "10",
                  labelIds: ["UNREAD", "TRASH"],
                  payload: { headers: [{ name: "Subject", value: "Trash" }] },
                },
              ],
            },
            {
              id: "thread-active",
              messages: [
                {
                  id: "message-active",
                  threadId: "thread-active",
                  historyId: "10",
                  labelIds: ["UNREAD"],
                  payload: { headers: [{ name: "Subject", value: "Active" }] },
                },
              ],
            },
          ]),
          {
            headers: {
              "content-type": "multipart/mixed; boundary=thread_boundary",
            },
          },
        );
      }

      throw new Error(`Unexpected Gmail request: ${url}`);
    });

    try {
      const result = await listMessagesWithDetails("token", { mailbox: "unread" });

      expect(result.messages.map((message) => message.id)).toEqual(["message-active"]);
      expect(calls).toHaveLength(3);
      expect(calls.some((call) => call.includes("/gmail/v1/users/me/messages/"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Gmail watch and history", () => {
  test("starts and stops a mailbox watch", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ body?: BodyInit | null; method?: string; url: string }> = [];

    setFetch(async (input, init) => {
      calls.push({
        body: init?.body,
        method: init?.method,
        url: getRequestUrl(input),
      });
      return calls.length === 1
        ? Response.json({
            expiration: "1780000000000",
            historyId: "123",
          })
        : new Response(null, { status: 204 });
    });

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
      expect(JSON.parse(getRequestBody(calls[0]?.body))).toEqual({
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

    setFetch(async (input) => {
      requestedUrl = getRequestUrl(input);
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
    });

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

    setFetch(async () =>
      Response.json(
        {
          error: {
            code: 404,
            message: "Requested entity was not found.",
            status: "NOT_FOUND",
          },
        },
        { status: 404 },
      ),
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
