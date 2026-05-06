import { describe, expect, test } from "bun:test";
import { extractListUnsubscribeTargets, refreshMailboxMessages } from "../src/gmail-service";

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
