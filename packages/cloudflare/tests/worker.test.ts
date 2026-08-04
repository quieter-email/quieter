import {
  createExecutionContext,
  createMessageBatch,
  evictDurableObject,
  getQueueResult,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import worker, { signaturesMatch } from "../src/worker";

const serviceAccount = "gmail-push@example.invalid";
const subscription = "projects/example/subscriptions/gmail";
const mailboxId = "mailbox-1";
const emailAddress = "mailbox@example.com";
const originalFetch = globalThis.fetch;
let jwks: { keys: JWK[] };
let privateKey: CryptoKey;

const encodeJson = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const liveSyncToken = async (overrides: Partial<{ expiresAt: number; issuedAt: number }> = {}) => {
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
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return `${payload}.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
};

const pubSubToken = (overrides: Record<string, unknown> = {}) =>
  new SignJWT({ email: serviceAccount, email_verified: true, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setAudience("https://audience.invalid/gmail/pubsub")
    .setIssuer("https://accounts.google.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

const pubSubRequest = async (
  body: unknown,
  options: { authorization?: string; contentLength?: number } = {},
) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.authorization !== undefined) {
    headers.set("authorization", options.authorization);
  } else {
    headers.set("authorization", `Bearer ${await pubSubToken()}`);
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

const messageFrom = (socket: WebSocket) =>
  new Promise<MessageEvent>((resolve) =>
    socket.addEventListener("message", resolve, { once: true }),
  );

const within = <T>(promise: Promise<T>, label: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 1_000),
    ),
  ]);

beforeAll(async () => {
  const keyPair = await generateKeyPair<CryptoKey>("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  jwks = { keys: [{ ...publicJwk, alg: "RS256", kid: "test-key", use: "sig" }] };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("live-sync authentication", () => {
  test("uses fixed-size timing-safe signature comparison", async () => {
    expect(await signaturesMatch("same", "same")).toBe(true);
    expect(await signaturesMatch("short", "a completely different length")).toBe(false);
  });

  test.each([
    ["tampered", async () => `${await liveSyncToken()}x`],
    ["expired", () => liveSyncToken({ expiresAt: Math.floor(Date.now() / 1000) - 1 })],
    ["malformed", async () => "not.a.valid.token"],
  ])("rejects %s tokens", async (_name, createToken) => {
    const response = await worker.fetch(
      new Request(`https://worker.invalid/gmail/live?token=${await createToken()}`, {
        headers: { upgrade: "websocket" },
      }),
      env,
    );
    expect(response.status).toBe(401);
  });
});

describe("Pub/Sub ingress", () => {
  const installFetchMock = (processorStatus = 204) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).hostname === "www.googleapis.com") {
          return Response.json(jwks);
        }
        if (request.url === "https://processor.invalid/process") {
          return new Response(null, { status: processorStatus });
        }
        return originalFetch(input, init);
      }),
    );

  test("requires authentication", async () => {
    const response = await worker.fetch(
      await pubSubRequest(envelope(), { authorization: "" }),
      env,
    );
    expect(response.status).toBe(401);
  });

  test("rejects malformed and oversized payloads", async () => {
    installFetchMock();
    const malformed = await worker.fetch(await pubSubRequest("{"), env);
    const oversized = await worker.fetch(
      await pubSubRequest("{}", { contentLength: 64 * 1_024 + 1 }),
      env,
    );
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
  });

  test("rejects a mismatched subscription", async () => {
    installFetchMock();
    const response = await worker.fetch(
      await pubSubRequest(envelope({ subscription: `${subscription}-other` })),
      env,
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
    expect(send).toHaveBeenCalledWith({
      emailAddress,
      historyId: "123",
      pubSubMessageId: "message-1",
      type: "notification",
    });
  });

  test("returns 5xx when enqueueing transiently fails", async () => {
    installFetchMock();
    vi.spyOn(env.GmailPsQueue, "send").mockRejectedValueOnce(new Error("temporary"));
    const response = await worker.fetch(await pubSubRequest(envelope()), env);
    expect(response.status).toBe(500);
  });
});

describe("Durable Object WebSockets", () => {
  test("upgrades, broadcasts attachments, auto-responds to exact pings, and closes", async () => {
    const token = await liveSyncToken();
    const stub = env.GmailLiveSyncMailbox.get(
      env.GmailLiveSyncMailbox.idFromName(emailAddress.trim().toLowerCase()),
    );
    const response = await stub.fetch(
      new Request(`https://worker.invalid/gmail/live?token=${token}`, {
        headers: { upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();

    const pong = messageFrom(socket);
    socket.send('{"action":"ping"}');
    expect((await within(pong, "automatic pong")).data).toBe('{"type":"pong"}');

    await evictDurableObject(stub);
    const broadcast = messageFrom(socket);
    expect(
      (
        await stub.fetch("https://internal.quieter/broadcast", {
          body: JSON.stringify({ type: "mailbox-dirty" }),
          method: "POST",
        })
      ).status,
    ).toBe(204);
    expect(JSON.parse(String((await within(broadcast, "broadcast")).data))).toEqual({
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

  const batch = () =>
    createMessageBatch<typeof body>("gmail-pubsub-types", [
      { attempts: 1, body, id: "message-1", timestamp: new Date() },
    ]);

  test("awaits the downstream response before acknowledging", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return new Response(null, { status: 204 });
      }),
    );
    const messages = batch();
    const context = createExecutionContext();
    let settled = false;
    const processing = worker.queue(messages, env, context).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await processing;
    expect(await getQueueResult(messages, context)).toMatchObject({ ackAll: false });
  });

  test("throws on downstream non-2xx responses so the batch retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const messages = batch();
    const context = createExecutionContext();
    await expect(worker.queue(messages, env, context)).rejects.toThrow("returned 503");
    expect(await getQueueResult(messages, context)).toMatchObject({
      ackAll: false,
    });
  });
});
