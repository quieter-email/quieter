import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  maintainGmailPubSubMailbox,
  processGmailPubSubNotification,
} from "@quieter/orpc/gmail-pubsub";
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWK } from "jose";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { enqueueGmailMaintenanceJobs } from "../src/gmail-maintenance-worker";
import { dispatchPendingMailboxActionRuns } from "../src/mailbox-action-dispatch-worker";
import { processMailboxActionMessage } from "../src/mailbox-action-worker";
import { processGmailQueueMessage } from "../src/queue-worker";
import worker, { signaturesMatch } from "../src/worker";

const serviceAccount = "gmail-push@example.invalid";
const subscription = "projects/example/subscriptions/gmail";
const mailboxId = "mailbox-1";
const emailAddress = "mailbox@example.com";
const originalFetch = globalThis.fetch;
let jwks: { keys: JWK[] };
let privateKey: CryptoKey;

const encodeJson = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const createClaimRuns = (runs: { runId: string }[]) =>
  vi.fn<() => Promise<{ runId: string }[]>>().mockResolvedValue(runs);

const createReleaseClaims = () =>
  vi.fn<(runIds: string[]) => Promise<void>>().mockResolvedValue();

const createExecuteRun = () =>
  vi
    .fn<
      (
        runId: string,
        options?: { finalAttempt?: boolean }
      ) => Promise<{ status: "succeeded" }>
    >()
    .mockResolvedValue({ status: "succeeded" });

const liveSyncToken = async (
  overrides: Partial<{ expiresAt: number; issuedAt: number }> = {}
) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeJson({
    emailAddress,
    expiresAt: now + 300,
    issuedAt: now,
    mailboxId,
    nonce: "56dd0984-cfdb-40a7-a31e-5e17fb78aefd",
    userId: "user-1",
    version: 1,
    ...overrides,
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("live-sync-secret"),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  );
  let binary = "";
  for (const byte of signature) {
    binary += String.fromCodePoint(byte);
  }
  return `${payload}.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
};

const pubSubToken = async (overrides: Record<string, unknown> = {}) =>
  await new SignJWT({
    email: serviceAccount,
    email_verified: true,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setAudience("https://audience.invalid/gmail/pubsub")
    .setIssuer("https://accounts.google.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

const pubSubRequest = async (
  body: unknown,
  options: { authorization?: string; contentLength?: number } = {}
) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.authorization === undefined) {
    headers.set("authorization", `Bearer ${await pubSubToken()}`);
  } else {
    headers.set("authorization", options.authorization);
  }
  if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }
  return new Request("https://worker.invalid/gmail/pubsub", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers,
    method: "POST",
  });
};

const envelope = (overrides: Record<string, unknown> = {}) => ({
  message: {
    data: encodeJson({ emailAddress, historyId: "123" }),
    messageId: "message-1",
  },
  subscription,
  ...overrides,
});

const isMessageEventTuple = (events: unknown): events is [MessageEvent] =>
  Array.isArray(events) &&
  events.length > 0 &&
  events[0] instanceof MessageEvent;

const messageFrom = async (socket: WebSocket) => {
  const events = await once(socket, "message");
  if (!isMessageEventTuple(events)) {
    throw new Error("Expected message event.");
  }
  const [event] = events;
  return event;
};

const within = async <T>(promise: Promise<T>, label: string) =>
  await Promise.race([
    promise,
    sleep(1000).then(() => {
      throw new Error(`Timed out waiting for ${label}.`);
    }),
  ]);

const toRequest = (input: RequestInfo | URL, init?: RequestInit) => {
  if (input instanceof Request) {
    return input;
  }
  const url = input instanceof URL ? input.toString() : input;
  return new Request(url, init);
};

describe("Cloudflare worker runtime", () => {
  beforeAll(async () => {
    const keyPair = await generateKeyPair<CryptoKey>("RS256");
    const { privateKey: generatedPrivateKey } = keyPair;
    privateKey = generatedPrivateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    jwks = {
      keys: [{ ...publicJwk, alg: "RS256", kid: "test-key", use: "sig" }],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("live-sync authentication", () => {
    test("uses fixed-size timing-safe signature comparison", async () => {
      await expect(signaturesMatch("same", "same")).resolves.toBeTruthy();
      await expect(
        signaturesMatch("short", "a completely different length")
      ).resolves.toBeFalsy();
    });

    test.each([
      ["tampered", async () => `${await liveSyncToken()}x`],
      [
        "expired",
        async () =>
          await liveSyncToken({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
      ],
      ["malformed", async () => await Promise.resolve("not.a.valid.token")],
    ])("rejects %s tokens", async (_name, createToken) => {
      const response = await worker.fetch(
        new Request(
          `https://worker.invalid/gmail/live?token=${await createToken()}`,
          {
            headers: { upgrade: "websocket" },
          }
        ),
        env
      );
      expect(response.status).toBe(401);
    });
  });

  describe("Pub/Sub ingress", () => {
    const installFetchMock = (processorStatus = 204) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = toRequest(input, init);
          if (new URL(request.url).hostname === "www.googleapis.com") {
            return Response.json(jwks);
          }
          if (request.url === "https://processor.invalid/process") {
            return new Response(null, { status: processorStatus });
          }
          return await originalFetch(input, init);
        })
      );

    test("requires authentication", async () => {
      const response = await worker.fetch(
        await pubSubRequest(envelope(), { authorization: "" }),
        env
      );
      expect(response.status).toBe(401);
    });

    test("rejects malformed and oversized payloads", async () => {
      installFetchMock();
      const malformed = await worker.fetch(await pubSubRequest("{"), env);
      const oversized = await worker.fetch(
        await pubSubRequest("{}", { contentLength: 64 * 1024 + 1 }),
        env
      );
      expect(malformed.status).toBe(400);
      expect(oversized.status).toBe(413);
    });

    test("rejects a mismatched subscription", async () => {
      installFetchMock();
      const response = await worker.fetch(
        await pubSubRequest(
          envelope({ subscription: `${subscription}-other` })
        ),
        env
      );
      expect(response.status).toBe(403);
    });

    test("broadcasts and enqueues an authenticated notification", async () => {
      installFetchMock();
      const send = vi.spyOn(env.GmailPsQueue, "send").mockResolvedValue({
        metadata: { metrics: { backlogBytes: 0, backlogCount: 1 } },
      });
      const response = await worker.fetch(await pubSubRequest(envelope()), env);
      expect(response.status).toBe(204);
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]?.[0]).toStrictEqual({
        emailAddress,
        historyId: "123",
        pubSubMessageId: "message-1",
        type: "notification",
      });
    });

    test("returns 5xx when enqueueing transiently fails", async () => {
      installFetchMock();
      vi.spyOn(env.GmailPsQueue, "send").mockRejectedValueOnce(
        new Error("temporary")
      );
      const response = await worker.fetch(await pubSubRequest(envelope()), env);
      expect(response.status).toBe(500);
    });
  });

  describe("Durable Object WebSockets", () => {
    test("upgrades, broadcasts attachments, auto-responds to exact pings, and closes", async () => {
      const token = await liveSyncToken();
      const stub = env.GmailLiveSyncMailbox.get(
        env.GmailLiveSyncMailbox.idFromName(emailAddress.trim().toLowerCase())
      );
      const response = await stub.fetch(
        new Request(`https://worker.invalid/gmail/live?token=${token}`, {
          headers: { upgrade: "websocket" },
        })
      );
      expect(response.status).toBe(101);
      const socket = response.webSocket;
      if (socket === null) {
        throw new Error("Expected WebSocket upgrade.");
      }
      socket.accept();

      const pong = messageFrom(socket);
      socket.send('{"action":"ping"}');
      const pongEvent = await within(pong, "automatic pong");
      expect(pongEvent.data).toBe('{"type":"pong"}');

      await evictDurableObject(stub);
      const broadcast = messageFrom(socket);
      const broadcastResponse = await stub.fetch(
        "https://internal.quieter/broadcast",
        {
          body: JSON.stringify({ type: "mailbox-dirty" }),
          method: "POST",
        }
      );
      expect(broadcastResponse.status).toBe(204);
      const broadcastEvent = await within(broadcast, "broadcast");
      expect(JSON.parse(String(broadcastEvent.data))).toStrictEqual({
        mailboxId,
        type: "mailbox-dirty",
      });

      socket.close(1000, "done");
      expect(socket.readyState).not.toBe(WebSocket.OPEN);
    });
  });

  describe("Queue consumer", () => {
    const body = {
      emailAddress,
      historyId: "123",
      pubSubMessageId: "message-1",
      type: "notification" as const,
    };

    test("processes notifications and broadcasts completed details", async () => {
      const processNotification = vi.fn<typeof processGmailPubSubNotification>(
        async (_message, options) => {
          await options?.onProcessed?.({ mailboxId });
          return {
            busy: false,
            ignored: false,
            mailboxId,
            pubSubMessageId: body.pubSubMessageId,
          };
        }
      );

      await processGmailQueueMessage(body, env, { processNotification });

      expect(processNotification).toHaveBeenCalledOnce();
      expect(processNotification.mock.calls[0]?.[0]).toStrictEqual(body);
      expect(processNotification.mock.calls[0]?.[1]?.onProcessed).toBeTypeOf(
        "function"
      );
    });

    test("processes maintenance jobs with the configured topic", async () => {
      const maintainMailbox = vi.fn<typeof maintainGmailPubSubMailbox>(
        // oxlint-disable-next-line eslint/require-await -- The production dependency has an async contract.
        async () => ({ status: "maintained" as const })
      );

      await processGmailQueueMessage(
        {
          emailAddress,
          mailboxId,
          type: "maintenance",
        },
        env,
        { maintainMailbox }
      );

      expect(maintainMailbox.mock.calls[0]?.[0]).toStrictEqual({
        mailboxId,
        topicName: "projects/example/topics/gmail",
      });
      expect(maintainMailbox.mock.calls[0]?.[1]?.onRunsEnqueued).toBeTypeOf(
        "function"
      );
    });

    test("rejects invalid queue messages", async () => {
      await expect(
        processGmailQueueMessage({ type: "notification" }, env)
      ).rejects.toThrow("Invalid input");
    });
  });

  test("batches scheduled Gmail maintenance jobs", async () => {
    const sendBatch = vi
      .spyOn(env.GmailPsQueue, "sendBatch")
      .mockResolvedValue({
        metadata: {
          metrics: { backlogBytes: 0, backlogCount: 0 },
        },
      });
    const jobs = Array.from({ length: 101 }, (_, index) => ({
      emailAddress: `mailbox-${index}@example.com`,
      mailboxId: `mailbox-${index}`,
    }));
    // oxlint-disable-next-line eslint/require-await -- The production dependency has an async contract.
    const listJobs = async () => jobs;

    await expect(
      enqueueGmailMaintenanceJobs(env, listJobs)
    ).resolves.toStrictEqual({ enqueued: 101 });

    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect([...(sendBatch.mock.calls[0]?.[0] ?? [])]).toHaveLength(100);
    expect([...(sendBatch.mock.calls[1]?.[0] ?? [])]).toHaveLength(1);
  });

  describe("Mailbox action dispatch", () => {
    const sendBatchResult = {
      metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
    };

    test("dispatches claimed runs and keeps claims on success", async () => {
      const claimRuns = createClaimRuns([
        { runId: "run-1" },
        { runId: "run-2" },
      ]);
      const releaseClaims = createReleaseClaims();
      const sendBatch = vi
        .spyOn(env.MailboxActionQueue, "sendBatch")
        .mockResolvedValue(sendBatchResult);

      await expect(
        dispatchPendingMailboxActionRuns(env, { claimRuns, releaseClaims })
      ).resolves.toStrictEqual({ dispatched: 2 });

      expect(sendBatch).toHaveBeenCalledOnce();
      expect([...(sendBatch.mock.calls[0]?.[0] ?? [])]).toStrictEqual([
        { body: { runId: "run-1" }, contentType: "json" },
        { body: { runId: "run-2" }, contentType: "json" },
      ]);
      expect(releaseClaims).not.toHaveBeenCalled();
    });

    test("releases the dispatch claim when a batch send fails", async () => {
      const firstBatch = Array.from({ length: 100 }, (_, index) => ({
        runId: `run-${index}`,
      }));
      const secondBatch = [{ runId: "run-final" }];
      const claimRuns = createClaimRuns([...firstBatch, ...secondBatch]);
      const releaseClaims = createReleaseClaims();
      const sendBatch = vi
        .spyOn(env.MailboxActionQueue, "sendBatch")
        .mockRejectedValueOnce(new Error("queue unavailable"))
        .mockResolvedValueOnce(sendBatchResult);

      await expect(
        dispatchPendingMailboxActionRuns(env, { claimRuns, releaseClaims })
      ).resolves.toStrictEqual({ dispatched: 1 });

      expect(sendBatch).toHaveBeenCalledTimes(2);
      expect(releaseClaims).toHaveBeenCalledOnce();
      expect(releaseClaims.mock.calls[0]?.[0]).toStrictEqual(
        firstBatch.map(({ runId }) => runId)
      );
    });
  });

  describe("Mailbox action messages", () => {
    test("marks intermediate delivery attempts as retryable", async () => {
      const executeRun = createExecuteRun();

      await processMailboxActionMessage(
        { runId: mailboxId },
        { attempt: 1, executeRun }
      );

      expect(executeRun.mock.calls[0]).toStrictEqual([
        mailboxId,
        { finalAttempt: false },
      ]);
    });

    test("flags the final queue delivery so failures settle the run", async () => {
      const executeRun = createExecuteRun();

      await processMailboxActionMessage(
        { runId: mailboxId },
        { attempt: 6, executeRun }
      );

      expect(executeRun.mock.calls[0]).toStrictEqual([
        mailboxId,
        { finalAttempt: true },
      ]);
    });

    test("rejects invalid messages before claiming a run", async () => {
      await expect(
        processMailboxActionMessage({}, { attempt: 1 })
      ).rejects.toThrow("Invalid input");
    });
  });
});
