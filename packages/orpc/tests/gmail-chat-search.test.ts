import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import type { captureMailboxMessageMemory } from "../src/ai-memory-capture";
import {
  modifyMailBatchForUser,
  searchGmailForUser,
} from "../src/gmail-chat-search";
import type {
  getAuthorizedGmailMailbox,
  markGmailMailboxNeedsReconnect,
} from "../src/gmail-mailbox-access";
import type { learnAiMemoryFromMailAction } from "../src/mail/feedback";

const fixtures = vi.hoisted(() => ({
  getMailbox: vi.fn<typeof getAuthorizedGmailMailbox>(),
  queueMemory: vi.fn<() => Promise<void>>(),
  refresh: vi.fn<() => Promise<string>>(),
}));

vi.mock(import("../src/gmail-mailbox-access"), () => ({
  getAuthorizedGmailMailbox: fixtures.getMailbox,
  markGmailMailboxNeedsReconnect:
    vi.fn<typeof markGmailMailboxNeedsReconnect>(),
  refreshAuthorizedGmailAccessToken: fixtures.refresh,
}));
vi.mock(import("../src/ai-memory-capture"), () => ({
  captureMailboxMessageMemory: vi.fn<typeof captureMailboxMessageMemory>(),
  queueMailboxMessageMemory: fixtures.queueMemory,
}));
vi.mock(import("../src/mail/feedback"), () => ({
  learnAiMemoryFromMailAction: vi.fn<typeof learnAiMemoryFromMailAction>(),
}));

const mailbox = {
  category: "inbox",
  mailboxId: "fixture-mailbox",
  userId: "fixture-user",
} as const;

const trashPath = /\/messages\/(?<id>[^/]+)\/trash$/u;

describe("Gmail chat search and batch actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fixtures.getMailbox.mockResolvedValue({
      accessToken: "fixture-token",
      mailbox: {
        accessTokenExpiresAt: null,
        emailAddress: "test@example.test",
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        id: mailbox.mailboxId,
        scopes: "",
        status: "connected",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("overlaps distinct trash requests and records confirmed successes when the provider interrupts a batch", async () => {
    const release = Promise.withResolvers<boolean>();
    const started: string[] = [];
    const ids = [
      "first",
      "unconfirmed",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "last",
    ];
    const provider: typeof fetch = async (url, options) => {
      const id = trashPath.exec(new URL(z.string().parse(url)).pathname)?.groups
        ?.id;
      if (options?.method !== "POST" || id === undefined) {
        throw new Error("Unexpected test provider request.");
      }
      started.push(id);
      await release.promise;
      return id === "unconfirmed"
        ? Response.json({ error: { message: "Unavailable" } }, { status: 503 })
        : Response.json({ id, labelIds: ["TRASH"] });
    };
    vi.stubGlobal("fetch", provider);

    const batch = modifyMailBatchForUser({
      ...mailbox,
      action: "trash",
      ids: [...ids, "first"],
      target: "message",
    });
    try {
      await vi.waitFor(() => {
        expect(started.length).toBeGreaterThan(1);
      });
      expect(started.length).toBeLessThan(ids.length);
    } finally {
      release.resolve(true);
    }
    const result = await batch;

    expect(result.status).toBe("error");
    expect(result.results).toHaveLength(ids.length);
    expect(result.results).toContainEqual({ id: "first", status: "success" });
    expect(result.results).toContainEqual({
      id: "unconfirmed",
      status: "error",
    });
    expect(result.results).toContainEqual({
      id: "last",
      status: "not_attempted",
    });
    expect(started).toHaveLength(new Set(started).size);
    expect(fixtures.queueMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: mailbox.mailboxId,
        messageIds: started.filter((id) => id !== "unconfirmed"),
      })
    );
  });

  test("retries only requests rejected by authentication after a shared token refresh", async () => {
    const successfulRequests: string[] = [];
    fixtures.refresh.mockResolvedValue("refreshed-token");
    const provider: typeof fetch = async (url, options) => {
      const id = trashPath.exec(new URL(z.string().parse(url)).pathname)?.groups
        ?.id;
      if (id === undefined) {
        throw new Error("Unexpected test provider request.");
      }
      const authorization = new Headers(options?.headers).get("authorization");
      if (id !== "accepted" && authorization === "Bearer fixture-token") {
        return await Promise.resolve(
          Response.json(
            { error: { message: "Invalid access", status: "UNAUTHENTICATED" } },
            { status: 401 }
          )
        );
      }
      successfulRequests.push(id);
      return await Promise.resolve(Response.json({ id, labelIds: ["TRASH"] }));
    };
    vi.stubGlobal("fetch", provider);
    const ids = ["accepted", "retry-first", "retry-second"];

    const result = await modifyMailBatchForUser({
      ...mailbox,
      action: "trash",
      ids,
      target: "message",
    });

    expect(result.status).toBe("success");
    expect(successfulRequests.toSorted()).toStrictEqual(ids.toSorted());
    expect(fixtures.refresh).toHaveBeenCalledOnce();
  });

  test("keeps accepted changes and skips unsent targets after cancellation", async () => {
    const cancel = new AbortController();
    const ids = Array.from({ length: 12 }, (_, index) => `mail-${index}`);
    const provider: typeof fetch = async (url) => {
      const id = trashPath.exec(new URL(z.string().parse(url)).pathname)?.groups
        ?.id;
      if (id === undefined) {
        throw new Error("Unexpected test provider request.");
      }
      if (id === ids[0]) {
        cancel.abort();
      }
      return await Promise.resolve(Response.json({ id, labelIds: ["TRASH"] }));
    };
    vi.stubGlobal("fetch", provider);

    const result = await modifyMailBatchForUser({
      ...mailbox,
      action: "trash",
      ids,
      signal: cancel.signal,
      target: "message",
    });

    expect(result.status).toBe("error");
    expect(result.results).toContainEqual({ id: ids[0], status: "success" });
    expect(result.results).toContainEqual({
      id: ids.at(-1),
      status: "not_attempted",
    });
  });

  test("applies a shared message label change in one provider batch", async () => {
    const provider = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", provider);

    const result = await modifyMailBatchForUser({
      ...mailbox,
      action: "mark_read",
      ids: ["first", "second", "first"],
      target: "message",
    });

    expect(result.status).toBe("success");
    expect(provider).toHaveBeenCalledOnce();
    const [request] = provider.mock.calls;
    expect(new URL(z.string().parse(request?.[0])).pathname).toMatch(
      /\/batchModify$/u
    );
    const body = z.string().parse(request?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({
      ids: ["first", "second"],
      removeLabelIds: ["UNREAD"],
    });
  });

  test("keeps confirmed provider receipts when local feedback cannot be saved", async () => {
    fixtures.queueMemory.mockRejectedValue(new Error("Feedback unavailable."));
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }))
    );

    const result = await modifyMailBatchForUser({
      ...mailbox,
      action: "mark_read",
      ids: ["confirmed"],
      target: "message",
    });

    expect(result.status).toBe("success");
    expect(result.results).toContainEqual({
      id: "confirmed",
      status: "success",
    });
  });

  test("keeps the selected folder by default and carries a mailbox-wide page token forward", async () => {
    const query = "subject:latency";
    const searches: URLSearchParams[] = [];
    const provider: typeof fetch = async (request, options) => {
      const url = new URL(z.string().parse(request));
      if (url.pathname.endsWith("/messages")) {
        searches.push(url.searchParams);
        const sent = url.searchParams.has("pageToken");
        return await Promise.resolve(
          Response.json({
            messages: [
              { id: sent ? "sent" : "inbox", threadId: "conversation" },
            ],
            nextPageToken: sent ? undefined : "page-two",
          })
        );
      }
      const body = z.string().parse(options?.body);
      const id = body.includes("/messages/sent?") ? "sent" : "inbox";
      const metadata = JSON.stringify({
        id,
        labelIds: [id.toUpperCase()],
        threadId: "conversation",
      });
      return await Promise.resolve(
        new Response(
          [
            "--metadata",
            "Content-Type: application/http",
            "Content-ID: <response-message-0>",
            "",
            "HTTP/1.1 200 OK",
            "Content-Type: application/json",
            "",
            metadata,
            "--metadata--",
            "",
          ].join("\r\n"),
          { headers: { "content-type": "multipart/mixed; boundary=metadata" } }
        )
      );
    };
    vi.stubGlobal("fetch", provider);

    const current = await searchGmailForUser({
      ...mailbox,
      maxResults: 1,
      query,
    });
    const first = await searchGmailForUser({
      ...mailbox,
      maxResults: 1,
      query,
      scope: "all_mail",
    });
    if (first.status !== "success") {
      throw new Error("Fixture search failed.");
    }
    const next = await searchGmailForUser({
      ...mailbox,
      maxResults: 1,
      pageToken: first.nextPageToken,
      query,
      scope: "all_mail",
    });

    expect(current).toMatchObject({ messages: [{ id: "inbox" }] });
    expect(next).toMatchObject({ messages: [{ id: "sent" }] });
    expect(searches[0]?.getAll("labelIds")).toContain("INBOX");
    expect(searches[2]?.has("labelIds")).toBeFalsy();
    expect(searches[2]?.get("q")).toBe(query);
    expect(searches[2]?.get("pageToken")).toBe(first.nextPageToken);
  });
});
