/* oxlint-disable require-await -- Async transport mocks follow promise-function-async. */
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createManagementClient,
  ManagementError,
  normalizeManagementOrigin,
} from "../src/index";
import type { ManagementMutationReview } from "../src/index";

const response = (body: unknown, status = 200) =>
  Response.json(body, {
    headers: { "Quieter-Control-Version": "2026-11" },
    status,
  });

const mutationId = "72b92a77-d43a-483d-99a2-e28b6e8c8423";
const otherMutationId = "72b92a77-d43a-483d-99a2-e28b6e8c8424";
const preparation = {
  idempotencyKey: "retained-key",
  openTrackingEnabled: false,
  organizationId: "organization",
};
const reviewBase = {
  createdAt: "2026-11-15T10:00:00Z",
  expiresAt: "2026-11-15T11:00:00Z",
  id: mutationId,
  operation: "organization.settings.update",
  organizationId: "organization",
  organizationName: "Team",
  patch: { openTrackingEnabled: false },
  reviewPath: `/control/review?approvalId=${mutationId}`,
} satisfies Omit<ManagementMutationReview, "status">;

describe("management client boundaries", () => {
  it.each([
    "http://example.com",
    "http://127.1",
    "http://2130706433",
    "http://localhost.example.com",
    "https://user:secret@example.com",
    "https://@example.com",
    "https://example.com/path",
    "https://example.com/path/..",
    "https://example.com/?private=value",
    "https://example.com/#private",
  ])("rejects an unsafe credential destination %s", (origin) => {
    expect(() => normalizeManagementOrigin(origin)).toThrow(ManagementError);
  });

  it.each([
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
  ])("accepts an exact loopback development origin %s", (origin) => {
    expect(normalizeManagementOrigin(origin)).toBe(origin);
  });

  it("refreshes the cookie for each request and restricts credential forwarding", async () => {
    const requests: Request[] = [];
    let cookie = "session=first";
    const client = createManagementClient({
      auth: {
        getCookie: ({ origin }) => {
          expect(origin).toBe("https://app.example.com");
          return cookie;
        },
        kind: "session-cookie",
      },
      fetch: async (url, init) => {
        requests.push(new Request(url, init));
        return response({ timeFormat: "24h", weekStartsOn: 1 });
      },
      origin: "https://app.example.com/",
    });
    await client.execute({ operation: "settings.read", parameters: {} });
    cookie = "session=second";
    await client.execute({ operation: "settings.read", parameters: {} });
    expect(
      requests.map((request) => request.headers.get("cookie"))
    ).toStrictEqual(["session=first", "session=second"]);
    expect(
      requests.every((request) => request.credentials === "omit")
    ).toBeTruthy();
    expect(
      requests.every((request) => request.redirect === "error")
    ).toBeTruthy();
  });

  it("uses the browser session without adding a cookie header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const request = new Request(url, init);
      expect(request.credentials).toBe("include");
      expect(request.headers.has("cookie")).toBeFalsy();
      return response({ operations: [] });
    });
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch,
      origin: "https://app.example.com",
    });
    await expect(
      client.capabilities({ target: { kind: "user" } })
    ).resolves.toMatchObject({ operations: [] });
  });

  it("validates requests before requesting credentials or sending network traffic", async () => {
    const getCookie = vi.fn<() => string>(() => "session=private");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createManagementClient({
      auth: { getCookie, kind: "session-cookie" },
      fetch,
      origin: "https://app.example.com",
    });
    await expect(
      client.execute({
        operation: "organization.settings.update",
        parameters: {
          approvalId: "approval",
          idempotencyKey: "key",
          organizationId: "organization",
        },
      })
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(getCookie).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves response metadata and derived mail fields from the shared contract", async () => {
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch: async () =>
        response({
          messages: [
            {
              draftAnchor: {
                seededBy: "reply",
                sourceMessageId: "source",
                sourceThreadId: "source-thread",
              },
              id: "message",
              inlineImages: [
                {
                  attachmentId: "attachment",
                  contentId: "image",
                  fileName: "picture.png",
                  mimeType: "image/png",
                  size: 10,
                },
              ],
              source: {
                href: "/?mailboxId=mailbox",
                mailboxId: "mailbox",
                messageId: "message",
                threadId: "thread",
              },
              threadId: "thread",
              threadMessageCount: 2,
              unsubscribeStatus: "requested",
            },
          ],
          nextPageToken: "next",
        }),
      origin: "https://app.example.com",
    });
    await expect(
      client.execute({
        operation: "mail.search",
        parameters: {
          category: "inbox",
          mailboxId: "mailbox",
          organizationId: "organization",
        },
      })
    ).resolves.toMatchObject({
      messages: [
        {
          draftAnchor: { seededBy: "reply" },
          inlineImages: [{ contentId: "image" }],
          threadMessageCount: 2,
          unsubscribeStatus: "requested",
        },
      ],
      nextPageToken: "next",
    });
  });

  it("keeps safe server error metadata and hides its untrusted message", async () => {
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch: async () =>
        response(
          {
            error: {
              code: "RATE_LIMITED",
              message: "secret=session-cookie",
              requestId: "request",
              retryAfterMs: 500,
            },
          },
          429
        ),
      origin: "https://app.example.com",
    });
    const failure = await client
      .execute({ operation: "settings.read", parameters: {} })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "RATE_LIMITED",
      requestId: "request",
      retryAfterMs: 500,
      status: 429,
    });
    expect(String(failure)).not.toContain("secret");
    expect(failure).not.toHaveProperty("cause");
  });

  it("hides credential callback and fetch exceptions", async () => {
    const getCookie = vi.fn<() => string>(() => {
      throw new Error("private cookie");
    });
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      throw new Error("private transport");
    });
    const client = createManagementClient({
      auth: { getCookie, kind: "session-cookie" },
      fetch,
      origin: "https://app.example.com",
    });
    const credentialError = await client
      .execute({ operation: "settings.read", parameters: {} })
      .catch((error: unknown) => error);
    expect(credentialError).toMatchObject({ code: "SESSION_UNAVAILABLE" });
    expect(String(credentialError)).not.toContain("private");
    expect(fetch).not.toHaveBeenCalled();
    const browser = createManagementClient({
      auth: { kind: "browser-session" },
      fetch,
      origin: "https://app.example.com",
    });
    const networkError = await browser
      .execute({ operation: "settings.read", parameters: {} })
      .catch((error: unknown) => error);
    expect(networkError).toMatchObject({ code: "NETWORK_ERROR" });
    expect(String(networkError)).not.toContain("private");
  });

  it.each([
    () => response({ unexpected: "private body" }),
    () =>
      response({ error: { code: "UNKNOWN", message: "private body" } }, 400),
    () =>
      new Response("private body", {
        headers: {
          "Quieter-Control-Version": "2026-11",
          "content-type": "application/json",
        },
      }),
    () => Response.json({ timeFormat: "24h", weekStartsOn: 1 }),
  ])(
    "rejects malformed or incompatible responses safely",
    async (makeResponse) => {
      const client = createManagementClient({
        auth: { kind: "browser-session" },
        fetch: async () => makeResponse(),
        origin: "https://app.example.com",
      });
      const failure = await client
        .execute({ operation: "settings.read", parameters: {} })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "INVALID_RESPONSE" });
      expect(String(failure)).not.toContain("private body");
    }
  );

  it("forwards abort and returns a safe cancellation without retry", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort(new Error("private reason"));
      throw new Error("private transport failure");
    });
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch,
      origin: "https://app.example.com",
    });
    await expect(
      client.execute({
        operation: "settings.read",
        parameters: {},
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("management mutation lifecycle boundaries", () => {
  it("sends the normalized preparation without filling omitted settings", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const request = new Request(url, init);
      expect(new URL(request.url).pathname).toBe(
        "/api/control/mutations/prepare"
      );
      const body: unknown = await request.json();
      expect(body).toMatchObject({
        idempotencyKey: "retained-key",
        openTrackingEnabled: false,
        organizationId: "organization",
      });
      expect(body).not.toHaveProperty("allowPerSendOverride");
      return response({ ...reviewBase, status: "prepared" });
    });
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch,
      origin: "https://app.example.com",
    });
    await expect(
      client.prepareSettingsUpdate({
        parameters: {
          ...preparation,
          idempotencyKey: " retained-key ",
          organizationId: " organization ",
        },
      })
    ).resolves.toMatchObject({ id: mutationId, status: "prepared" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { parameters: preparation, patch: { openTrackingEnabled: true } },
    { parameters: preparation, patch: { allowPerSendOverride: false } },
    {
      parameters: preparation,
      patch: { allowPerSendOverride: false, openTrackingEnabled: false },
    },
    {
      parameters: { ...preparation, allowPerSendOverride: false },
      patch: { openTrackingEnabled: false },
    },
  ])(
    "rejects an altered preparation patch %#",
    async ({ parameters, patch }) => {
      const client = createManagementClient({
        auth: { kind: "browser-session" },
        fetch: async () =>
          response({ ...reviewBase, patch, status: "prepared" }),
        origin: "https://app.example.com",
      });
      await expect(
        client.prepareSettingsUpdate({ parameters })
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  );

  it.each([
    { organizationId: "other-organization" },
    { reviewPath: `/control/review?approvalId=${otherMutationId}` },
    { operation: "settings.read" },
    { status: "approved" },
  ])(
    "rejects an unrelated or malformed preparation response %#",
    async (change) => {
      const client = createManagementClient({
        auth: { kind: "browser-session" },
        fetch: async () =>
          response({ ...reviewBase, status: "prepared", ...change }),
        origin: "https://app.example.com",
      });
      await expect(
        client.prepareSettingsUpdate({ parameters: preparation })
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  );

  it("rejects invalid preparation claims before reading credentials", async () => {
    const getCookie = vi.fn<() => string>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createManagementClient({
      auth: { getCookie, kind: "session-cookie" },
      fetch,
      origin: "https://app.example.com",
    });
    const parameters = { ...preparation, approvalId: mutationId };
    await expect(
      client.prepareSettingsUpdate({ parameters })
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      client.prepareSettingsUpdate({
        parameters: { idempotencyKey: "key", organizationId: "organization" },
      })
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(getCookie).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<"reviewMutation" | "cancelMutation">([
    "reviewMutation",
    "cancelMutation",
  ])("rejects extra action claims before credentials in %s", async (method) => {
    const getCookie = vi.fn<() => string>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createManagementClient({
      auth: { getCookie, kind: "session-cookie" },
      fetch,
      origin: "https://app.example.com",
    });
    for (const claims of [
      { organizationId: "other" },
      { patch: { openTrackingEnabled: true } },
      { approvalId: mutationId },
      { confirmed: true },
      { operation: "organization.settings.update" },
      { id: "invalid-id" },
    ]) {
      const action = {
        id: mutationId,
        signal: new AbortController().signal,
        ...claims,
      };
      await expect(client[method](action)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    expect(getCookie).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<"reviewMutation" | "cancelMutation">([
    "reviewMutation",
    "cancelMutation",
  ])("rejects another mutation's valid response in %s", async (method) => {
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch: async () =>
        response({
          ...reviewBase,
          id: otherMutationId,
          reviewPath: `/control/review?approvalId=${otherMutationId}`,
          status: "prepared",
        }),
      origin: "https://app.example.com",
    });
    await expect(client[method]({ id: mutationId })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it.each<ManagementMutationReview>([
    { ...reviewBase, status: "prepared" },
    {
      ...reviewBase,
      approvedAt: "2026-11-15T10:01:00Z",
      status: "approved",
    },
    {
      ...reviewBase,
      approvedAt: "2026-11-15T10:01:00Z",
      completedAt: "2026-11-15T10:02:00Z",
      result: { allowPerSendOverride: true, openTrackingEnabled: false },
      status: "succeeded",
    },
    {
      ...reviewBase,
      approvedAt: null,
      completedAt: "2026-11-15T10:02:00Z",
      error: {
        code: "CONFLICT",
        message: "This change cannot be completed. Review it and try again.",
        requestId: "failure-request",
      },
      status: "failed",
    },
    {
      ...reviewBase,
      approvedAt: null,
      completedAt: "2026-11-15T10:02:00Z",
      status: "cancelled",
    },
    {
      ...reviewBase,
      approvedAt: null,
      completedAt: "2026-11-15T11:00:00Z",
      status: "expired",
    },
  ])(
    "returns $status as review data for every lifecycle action",
    async (review) => {
      const controller = new AbortController();
      const paths: string[] = [];
      const bodies: unknown[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
        const request = new Request(url, init);
        paths.push(new URL(request.url).pathname);
        bodies.push(await request.json());
        expect(request.headers.has("X-Quieter-Review")).toBeFalsy();
        expect(init?.signal).toBe(controller.signal);
        return response(review);
      });
      const client = createManagementClient({
        auth: { kind: "browser-session" },
        fetch,
        origin: "https://app.example.com",
      });
      const results = [
        await client.prepareSettingsUpdate({
          parameters: preparation,
          signal: controller.signal,
        }),
        await client.reviewMutation({
          id: mutationId,
          signal: controller.signal,
        }),
        await client.cancelMutation({
          id: mutationId,
          signal: controller.signal,
        }),
      ];
      for (const result of results) {
        expect(result).toMatchObject({ id: mutationId, status: review.status });
      }
      expect(paths).toStrictEqual([
        "/api/control/mutations/prepare",
        "/api/control/mutations/review",
        "/api/control/mutations/cancel",
      ]);
      expect(bodies).toStrictEqual([
        preparation,
        { id: mutationId },
        { id: mutationId },
      ]);
      expect(fetch).toHaveBeenCalledTimes(3);
    }
  );

  it("retains a failed review's safe error as domain data", async () => {
    const error = {
      code: "CONFLICT",
      message: "This change cannot be completed. Review it and try again.",
      requestId: "failure-request",
    };
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch: async () =>
        response({
          ...reviewBase,
          approvedAt: null,
          completedAt: "2026-11-15T10:02:00Z",
          error,
          status: "failed",
        }),
      origin: "https://app.example.com",
    });
    await expect(
      client.reviewMutation({ id: mutationId })
    ).resolves.toMatchObject({ error, status: "failed" });
  });

  it("leaves recovery to the caller after an uncertain preparation", async () => {
    const bodies: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      bodies.push(await new Request(url, init).json());
      if (bodies.length === 1) {
        throw new Error("private transport exception");
      }
      return response({ ...reviewBase, status: "prepared" });
    });
    const client = createManagementClient({
      auth: { kind: "browser-session" },
      fetch,
      origin: "https://app.example.com",
    });
    const failure = await client
      .prepareSettingsUpdate({ parameters: preparation })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "NETWORK_ERROR" });
    expect(String(failure)).not.toContain("private");
    expect(fetch).toHaveBeenCalledOnce();
    await expect(
      client.prepareSettingsUpdate({ parameters: preparation })
    ).resolves.toMatchObject({ id: mutationId });
    expect(bodies).toStrictEqual([preparation, preparation]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
