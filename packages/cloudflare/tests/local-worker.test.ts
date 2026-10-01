import { processGmailPubSubNotification } from "@quieter/orpc/gmail-pubsub";
import type {
  findGmailUpdateMailboxIds,
  listMailUpdateRecipients,
} from "@quieter/orpc/mail-updates";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import localWorker from "../src/local-worker";

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve request-scope DB without opening a connection in ingress tests.
    withRequestDatabaseClient: async (callback) => await callback(original.db),
  };
});

vi.mock(import("@quieter/orpc/gmail-pubsub"), () => ({
  processGmailPubSubNotification: vi.fn<typeof processGmailPubSubNotification>(
    async () =>
      await Promise.resolve({
        busy: false,
        ignored: false,
        mailboxId: "test-mailbox",
        pubSubMessageId: "local-test-delivery",
      })
  ),
}));

vi.mock(import("@quieter/orpc/mail-updates"), () => ({
  findGmailUpdateMailboxIds: vi.fn<typeof findGmailUpdateMailboxIds>(
    async () => await Promise.resolve([])
  ),
  listMailUpdateRecipients: vi.fn<typeof listMailUpdateRecipients>(
    async () => await Promise.resolve([])
  ),
}));

const settings = vi.hoisted(() => ({
  QUIETER_DEPLOYMENT_ENV: "local" as "local" | "production",
  QUIETER_LOCAL_GMAIL_WATCH_OWNER: "production",
  QUIETER_LOCAL_PROVIDER_MODE: "observe",
  QUIETER_LOCAL_WORKER_TOKEN: "local-worker-test-token-with-32-characters",
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      get QUIETER_DEPLOYMENT_ENV() {
        return settings.QUIETER_DEPLOYMENT_ENV;
      },
      QUIETER_LOCAL_WORKER_TOKEN: settings.QUIETER_LOCAL_WORKER_TOKEN,
    },
  };
});

const request = (body: string, override?: [string, string]) => {
  const headers = new Headers({
    authorization: `Bearer ${settings.QUIETER_LOCAL_WORKER_TOKEN}`,
  });
  if (override !== undefined) {
    headers.set(...override);
  }
  return new Request<unknown, IncomingRequestCfProperties>(
    "http://localhost/__dev/pubsub",
    {
      body,
      headers,
      method: "POST",
    }
  );
};

const delivery = {
  message: {
    data: btoa(
      JSON.stringify({ emailAddress: "test@example.invalid", historyId: "42" })
    ),
    messageId: "local-test-delivery",
  },
  subscription: env.GMAIL_PUBSUB_SUBSCRIPTION,
};

describe("local background entrypoint", () => {
  afterEach(() => {
    settings.QUIETER_DEPLOYMENT_ENV = "local";
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  test.each([
    ["authorization", ""],
    ["authorization", "Bearer wrong"],
    ["origin", "https://untrusted.invalid"],
  ])(
    "rejects missing or incorrect credentials and browser origins",
    async (key, value) => {
      const response = await localWorker.fetch(
        request(JSON.stringify(delivery), [key, value]),
        env
      );
      expect(response.status).toBe(403);
      expect(processGmailPubSubNotification).not.toHaveBeenCalled();
    }
  );

  test("hides local routes outside development", async () => {
    settings.QUIETER_DEPLOYMENT_ENV = "production";
    const response = await localWorker.fetch(request("{}"), env);
    expect(response.status).toBe(404);
  });

  test.each([
    ["{}", 400],
    ['{"ownerEmail":"invalid"}', 400],
    ["{", 400],
    [" ".repeat(4097), 413],
  ])(
    "rejects invalid fixture input before database access",
    async (body, status) => {
      const response = await localWorker.fetch(
        new Request("http://localhost/__dev/mail/seed", {
          body,
          headers: {
            authorization: `Bearer ${settings.QUIETER_LOCAL_WORKER_TOKEN}`,
          },
          method: "POST",
        }),
        env
      );
      expect(response.status).toBe(status);
    }
  );

  test.each([
    ["local", "", undefined, 403],
    [
      "local",
      `Bearer ${settings.QUIETER_LOCAL_WORKER_TOKEN}`,
      "http://localhost:3000",
      403,
    ],
    [
      "production",
      `Bearer ${settings.QUIETER_LOCAL_WORKER_TOKEN}`,
      undefined,
      404,
    ],
  ] as const)(
    "protects fixture creation",
    async (mode, authorization, origin, status) => {
      settings.QUIETER_DEPLOYMENT_ENV = mode;
      const headers = new Headers({ authorization });
      if (origin !== undefined) {
        headers.set("origin", origin);
      }
      const response = await localWorker.fetch(
        new Request("http://localhost/__dev/mail/seed", {
          body: JSON.stringify({ ownerEmail: "fixture@example.test" }),
          headers,
          method: "POST",
        }),
        env
      );
      expect(response.status).toBe(status);
    }
  );

  test.each([
    ["{}", 400],
    ["{", 400],
    [JSON.stringify({ ...delivery, subscription: "production" }), 403],
    [" ".repeat(65_537), 413],
    [
      JSON.stringify({ ...delivery, message: { data: "!", messageId: "x" } }),
      400,
    ],
  ])("rejects invalid deliveries before processing", async (body, status) => {
    const response = await localWorker.fetch(request(body), env);
    expect(response.status).toBe(status);
    expect(processGmailPubSubNotification).not.toHaveBeenCalled();
  });

  test("processes validated deliveries before acknowledging", async () => {
    const response = await localWorker.fetch(
      request(JSON.stringify(delivery)),
      env
    );
    expect(response.status).toBe(204);
    expect(processGmailPubSubNotification).toHaveBeenCalledExactlyOnceWith({
      emailAddress: "test@example.invalid",
      historyId: "42",
      pubSubMessageId: "local-test-delivery",
    });
  });

  test("returns 503 while mailbox processing is leased", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValueOnce({
      busy: true,
      ignored: false,
      mailboxId: "test-mailbox",
      pubSubMessageId: "local-test-delivery",
    });
    const response = await localWorker.fetch(
      request(JSON.stringify(delivery)),
      env
    );
    expect(response.status).toBe(503);
  });
});
