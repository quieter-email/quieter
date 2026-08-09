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

const createIdentifiedBatchResponse = (
  boundary: string,
  parts: readonly { body: unknown; contentId: string; status?: number }[]
) =>
  [
    ...parts.map(({ body, contentId, status = 200 }) =>
      [
        `--${boundary}`,
        "Content-Type: application/http",
        `Content-ID: <response-${contentId}>`,
        "",
        `HTTP/1.1 ${status} ${status === 200 ? "OK" : "Service Unavailable"}`,
        "Content-Type: application/json",
        "",
        JSON.stringify(body),
      ].join("\r\n")
    ),
    `--${boundary}--`,
    "",
  ].join("\r\n");

const getRequestBody = (body: BodyInit | null | undefined) =>
  typeof body === "string" ? body : "";

const getRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

const resolveJson = async (body: unknown, init?: ResponseInit) =>
  await Promise.resolve(Response.json(body, init));

const resolveResponse = async (response: Response) =>
  await Promise.resolve(response);

const setFetch = (
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) => {
  Reflect.set(globalThis, "fetch", fetch);
};

describe(extractListUnsubscribeTargets, () => {
  test("extracts mailto and url targets", () => {
    expect(
      extractListUnsubscribeTargets(
        "<https://example.com/unsubscribe?id=123>, <mailto:list@example.com?subject=unsubscribe>"
      )
    ).toStrictEqual({
      mailto: "mailto:list@example.com?subject=unsubscribe",
      url: "https://example.com/unsubscribe?id=123",
    });
  });

  test("keeps the first valid target for each supported scheme", () => {
    expect(
      extractListUnsubscribeTargets(
        "<mailto:first@example.com>, <mailto:second@example.com>, <https://example.com/first>, <https://example.com/second>"
      )
    ).toStrictEqual({
      mailto: "mailto:first@example.com",
      url: "https://example.com/first",
    });
  });

  test("ignores unsupported and invalid targets", () => {
    expect(
      extractListUnsubscribeTargets(
        "<ftp://example.com/unsubscribe>, <javascript:alert(1)>, <mailto:>, <https://example.com/unsubscribe>"
      )
    ).toStrictEqual({
      mailto: undefined,
      url: "https://example.com/unsubscribe",
    });
  });
});

describe(getGmailMessageCount, () => {
  test("counts exact results under the configured cap instead of trusting stale estimates", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    setFetch(async (input) => {
      requestedUrl = getRequestUrl(input);
      return await resolveJson({
        messages: [
          { id: "message-1", threadId: "thread-1" },
          { id: "message-2", threadId: "thread-2" },
          { id: "message-3", threadId: "thread-3" },
        ],
        resultSizeEstimate: 201,
      });
    });

    try {
      await expect(
        getGmailMessageCount("token", {
          accurateUpTo: 99,
          mailbox: "unread",
          query: "-in:spam -in:trash",
        })
      ).resolves.toBe(3);

      const { searchParams } = new URL(requestedUrl);
      expect(searchParams.get("labelIds")).toBe("UNREAD");
      expect(searchParams.get("q")).toBe("-in:spam -in:trash");
      expect(searchParams.get("maxResults")).toBe("100");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deduplicates Gmail threads for thread-based unread counts", async () => {
    const originalFetch = globalThis.fetch;

    setFetch(
      async () =>
        await resolveJson({
          messages: [
            { id: "message-1", threadId: "thread-1" },
            { id: "message-2", threadId: "thread-1" },
            { id: "message-3", threadId: "thread-2" },
          ],
          resultSizeEstimate: 3,
        })
    );

    try {
      await expect(
        getGmailMessageCount("token", {
          accurateUpTo: 99,
          countBy: "threads",
          mailbox: "unread",
          query: "-in:spam -in:trash",
        })
      ).resolves.toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe(listGmailMessageIds, () => {
  test("excludes spam and trash from the unread mailbox query", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    setFetch(async (input) => {
      requestedUrl = getRequestUrl(input);
      return await resolveJson({
        messages: [],
      });
    });

    try {
      await listGmailMessageIds("token", { mailbox: "unread" });

      const { searchParams } = new URL(requestedUrl);
      expect(searchParams.get("labelIds")).toBe("UNREAD");
      expect(searchParams.get("q")).toBe("-in:spam -in:trash");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe(listMessagesWithDetails, () => {
  test("exposes the union of labels from every message in a thread", async () => {
    const originalFetch = globalThis.fetch;

    setFetch(async (input, init) => {
      const url = getRequestUrl(input);
      const body = getRequestBody(init?.body);

      if (
        url.includes("/gmail/v1/users/me/threads") &&
        !url.includes("/batch/")
      ) {
        return await resolveJson({
          threads: [{ historyId: "10", id: "thread-1" }],
        });
      }

      if (url.includes("/gmail/v1/users/me/profile")) {
        return await resolveJson({
          emailAddress: "user@example.com",
          historyId: "10",
        });
      }

      if (body.includes("/gmail/v1/users/me/threads/thread-1")) {
        return await resolveResponse(
          new Response(
            createIdentifiedBatchResponse("thread_labels_boundary", [
              {
                body: {
                  historyId: "10",
                  id: "thread-1",
                  messages: [
                    {
                      id: "message-latest",
                      internalDate: "2000",
                      labelIds: ["INBOX", "Label_Latest"],
                      payload: {
                        headers: [{ name: "Subject", value: "Labels" }],
                      },
                      threadId: "thread-1",
                    },
                    {
                      id: "message-previous",
                      internalDate: "1000",
                      labelIds: ["INBOX", "Label_Previous"],
                      payload: {
                        headers: [{ name: "Subject", value: "Labels" }],
                      },
                      threadId: "thread-1",
                    },
                  ],
                },
                contentId: "thread-0",
              },
            ]),
            {
              headers: {
                "content-type":
                  "multipart/mixed; boundary=thread_labels_boundary",
              },
            }
          )
        );
      }

      throw new Error(`Unexpected Gmail request: ${url}`);
    });

    try {
      const result = await listMessagesWithDetails("token");

      expect(result.messages[0]?.threadLabelIds).toStrictEqual([
        "INBOX",
        "Label_Latest",
        "Label_Previous",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("compiles Archive to Gmail system-category exclusions", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    setFetch(async (input) => {
      const url = getRequestUrl(input);
      if (url.includes("/profile")) {
        return await resolveJson({
          emailAddress: "user@example.com",
          historyId: "10",
        });
      }
      requestedUrl = url;
      return await resolveJson({ resultSizeEstimate: 0, threads: [] });
    });

    try {
      const result = await listMessagesWithDetails("token", {
        mailbox: "archive",
        query: "is:archived from:alex@example.com",
      });
      const query = new URL(requestedUrl).searchParams.get("q");

      expect(result.messages).toStrictEqual([]);
      expect(query).toSatisfy(
        (value) =>
          typeof value === "string" &&
          value.includes("from:alex@example.com") &&
          value.includes("-in:inbox") &&
          value.includes("-in:sent") &&
          value.includes("-label:drafts") &&
          !value.includes("is:archived")
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("compiles negated Archive to Gmail system-category membership", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    setFetch(async (input) => {
      const url = getRequestUrl(input);
      if (url.includes("/profile")) {
        return await resolveJson({
          emailAddress: "user@example.com",
          historyId: "10",
        });
      }
      requestedUrl = url;
      return await resolveJson({ resultSizeEstimate: 0, threads: [] });
    });

    try {
      await listMessagesWithDetails("token", {
        mailbox: "inbox",
        query: "-is:archived from:alex@example.com",
      });
      const query = new URL(requestedUrl).searchParams.get("q");

      expect(query).toContain(
        "{in:inbox in:sent label:drafts in:spam in:trash}"
      );
      expect(query).not.toContain("is:archived");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("filters spam and trash out of unread mailbox details", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    let threadBatchCalls = 0;

    setFetch(async (input, init) => {
      const url = getRequestUrl(input);
      const body = getRequestBody(init?.body);
      calls.push(`${url}\n${body}`);

      if (
        url.includes("/gmail/v1/users/me/threads") &&
        !url.includes("/batch/")
      ) {
        return await resolveJson({
          resultSizeEstimate: 3,
          threads: [
            { id: "thread-spam" },
            { id: "thread-trash" },
            { id: "thread-active" },
          ],
        });
      }

      if (url.includes("/gmail/v1/users/me/profile")) {
        return await resolveJson({
          emailAddress: "user@example.com",
          historyId: "10",
        });
      }

      if (body.includes("/gmail/v1/users/me/threads/")) {
        threadBatchCalls += 1;
        if (threadBatchCalls > 1) {
          return await resolveResponse(
            new Response(
              createIdentifiedBatchResponse("thread_retry_boundary", [
                {
                  body: {
                    id: "thread-trash",
                    messages: [
                      {
                        historyId: "10",
                        id: "message-trash",
                        labelIds: ["UNREAD", "TRASH"],
                        payload: {
                          headers: [{ name: "Subject", value: "Trash" }],
                        },
                        threadId: "thread-trash",
                      },
                    ],
                  },
                  contentId: "thread-0",
                },
              ]),
              {
                headers: {
                  "content-type":
                    "multipart/mixed; boundary=thread_retry_boundary",
                },
              }
            )
          );
        }
        return await resolveResponse(
          new Response(
            createIdentifiedBatchResponse("thread_boundary", [
              {
                body: {
                  id: "thread-active",
                  messages: [
                    {
                      historyId: "10",
                      id: "message-active",
                      labelIds: ["UNREAD"],
                      payload: {
                        headers: [{ name: "Subject", value: "Active" }],
                      },
                      threadId: "thread-active",
                    },
                  ],
                },
                contentId: "thread-2",
              },
              {
                body: {
                  id: "thread-spam",
                  messages: [
                    {
                      historyId: "10",
                      id: "message-spam",
                      labelIds: ["UNREAD", "SPAM"],
                      payload: {
                        headers: [{ name: "Subject", value: "Spam" }],
                      },
                      threadId: "thread-spam",
                    },
                  ],
                },
                contentId: "thread-0",
              },
              {
                body: { error: { message: "Temporary failure" } },
                contentId: "thread-1",
                status: 503,
              },
            ]),
            {
              headers: {
                "content-type": "multipart/mixed; boundary=thread_boundary",
              },
            }
          )
        );
      }

      throw new Error(`Unexpected Gmail request: ${url}`);
    });

    try {
      const result = await listMessagesWithDetails("token", {
        mailbox: "unread",
      });

      expect(result.messages.map((message) => message.id)).toStrictEqual([
        "message-active",
      ]);
      expect(threadBatchCalls).toBe(2);
      expect(calls).toHaveLength(4);
      expect(
        calls.some((call) => call.includes("/gmail/v1/users/me/messages/"))
      ).toBeFalsy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Gmail watch and history", () => {
  test("starts and stops a mailbox watch", async () => {
    const originalFetch = globalThis.fetch;
    const calls: {
      body?: BodyInit | null;
      method?: string;
      url: string;
    }[] = [];

    setFetch(async (input, init) => {
      calls.push({
        body: init?.body,
        method: init?.method,
        url: getRequestUrl(input),
      });
      if (calls.length === 1) {
        return await resolveJson({
          expiration: "1780000000000",
          historyId: "123",
        });
      }
      return await resolveResponse(new Response(null, { status: 204 }));
    });

    try {
      const watch = await watchGmailMailbox(
        "token",
        "projects/project/topics/gmail"
      );
      await stopGmailWatch("token");

      expect(watch).toStrictEqual({
        expiration: new Date(1_780_000_000_000),
        historyId: "123",
      });
      expect(calls[0]).toMatchObject({
        method: "POST",
        url: "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      });
      expect(JSON.parse(getRequestBody(calls[0]?.body))).toStrictEqual({
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
      return await resolveJson({
        history: [
          {
            id: "101",
            messagesAdded: [
              { message: { id: "message-1", threadId: "thread-1" } },
            ],
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
      await expect(
        listGmailAddedMessageHistoryPage("token", {
          pageToken: "page",
          startHistoryId: "100",
        })
      ).resolves.toStrictEqual({
        hasMore: true,
        historyExpired: false,
        historyId: "110",
        messageIds: ["message-1", "message-2"],
        nextPageToken: "next",
      });
      expect(new URL(requestedUrl).searchParams.get("pageToken")).toBe("page");
      expect(new URL(requestedUrl).searchParams.get("startHistoryId")).toBe(
        "100"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("marks an expired Gmail history cursor for recovery", async () => {
    const originalFetch = globalThis.fetch;

    setFetch(
      async () =>
        await resolveJson(
          {
            error: {
              code: 404,
              message: "Requested entity was not found.",
              status: "NOT_FOUND",
            },
          },
          { status: 404 }
        )
    );

    try {
      await expect(
        listGmailAddedMessageHistoryPage("token", {
          startHistoryId: "expired",
        })
      ).resolves.toStrictEqual({
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
