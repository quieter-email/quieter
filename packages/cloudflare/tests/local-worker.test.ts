import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import localWorker from "../src/local-worker";

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
    vi.restoreAllMocks();
  });

  test.each([
    ["authorization", ""],
    ["authorization", "Bearer wrong"],
    ["origin", "https://untrusted.invalid"],
  ])(
    "rejects missing or incorrect credentials and browser origins",
    async (key, value) => {
      const send = vi.spyOn(env.GmailPsQueue, "send").mockResolvedValue({
        metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
      });
      const response = await localWorker.fetch(
        request(JSON.stringify(delivery), [key, value]),
        env
      );
      expect(response.status).toBe(403);
      expect(send).not.toHaveBeenCalled();
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
  ])("rejects invalid deliveries without enqueueing", async (body, status) => {
    const send = vi.spyOn(env.GmailPsQueue, "send").mockResolvedValue({
      metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
    });
    const response = await localWorker.fetch(request(body), env);
    expect(response.status).toBe(status);
    expect(send).not.toHaveBeenCalled();
  });

  test("enqueues only validated deliveries from its configured subscription", async () => {
    const send = vi.spyOn(env.GmailPsQueue, "send").mockResolvedValue({
      metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
    });
    const response = await localWorker.fetch(
      request(JSON.stringify(delivery)),
      env
    );
    expect(response.status).toBe(204);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      emailAddress: "test@example.invalid",
      historyId: "42",
      pubSubMessageId: "local-test-delivery",
      type: "notification",
    });
  });
});
