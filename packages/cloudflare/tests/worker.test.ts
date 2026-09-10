import type {
  maintainGmailPubSubMailbox,
  processGmailPubSubNotification,
} from "@quieter/orpc/gmail-pubsub";
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
import { processGmailQueueMessage } from "../src/queue-worker";
import { RequestError } from "../src/request-error";
import worker from "../src/worker";
import { handlePubSub, requestErrorResponse } from "../src/worker-utils";

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

  describe("Pub/Sub ingress", () => {
    test("retries lease contention without reporting it as a server failure", () => {
      const report = vi.fn<(error: unknown) => void>();
      vi.stubGlobal("reportError", report);
      expect(
        requestErrorResponse(
          new RequestError(503, "mailbox_busy"),
          "/gmail/pubsub"
        ).status
      ).toBe(503);
      expect(report).not.toHaveBeenCalled();
      const failure = new Error("Unexpected provider failure");
      expect(requestErrorResponse(failure, "/gmail/pubsub").status).toBe(500);
      expect(report).toHaveBeenCalledWith(failure);
    });
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

    test("processes authenticated notifications before acknowledging without queueing", async () => {
      installFetchMock();
      const send = vi.spyOn(env.GmailPsQueue, "send");
      const { promise: pending, resolve: finish } =
        Promise.withResolvers<null>();
      const processNotification = vi.fn<
        (message: unknown, bindings: Env) => Promise<void>
      >(async () => {
        await pending;
      });
      let acknowledged = false;
      const responsePromise = handlePubSub(
        await pubSubRequest(envelope()),
        env,
        processNotification
      ).then((response) => {
        acknowledged = true;
        return response;
      });
      await vi.waitFor(() => {
        expect(processNotification).toHaveBeenCalledOnce();
      });
      expect(acknowledged).toBeFalsy();
      expect(processNotification.mock.calls[0]).toStrictEqual([
        {
          emailAddress,
          historyId: "123",
          pubSubMessageId: "message-1",
          type: "notification",
        },
        env,
      ]);
      finish(null);
      const response = await responsePromise;
      expect(response.status).toBe(204);
      expect(send).not.toHaveBeenCalled();
    });

    test("returns 5xx when direct processing transiently fails", async () => {
      installFetchMock();
      const processNotification = vi
        .fn<(message: unknown, bindings: Env) => Promise<void>>()
        .mockRejectedValue(new Error("temporary"));
      const response = await handlePubSub(
        await pubSubRequest(envelope()),
        env,
        processNotification
      ).catch((error: unknown) => requestErrorResponse(error, "/gmail/pubsub"));
      expect(response.status).toBe(500);
    });

    test("does not process a notification with an invalid subscription", async () => {
      installFetchMock();
      const processNotification =
        vi.fn<(message: unknown, bindings: Env) => Promise<void>>();
      await expect(
        handlePubSub(
          await pubSubRequest(envelope({ subscription: "other" })),
          env,
          processNotification
        )
      ).rejects.toThrow("subscription");
      expect(processNotification).not.toHaveBeenCalled();
    });
  });

  describe("Queue consumer", () => {
    const body = {
      emailAddress,
      historyId: "123",
      pubSubMessageId: "message-1",
      type: "notification" as const,
    };

    test("processes notifications through the mail service", async () => {
      const processNotification = vi.fn<typeof processGmailPubSubNotification>(
        async () => {
          await Promise.resolve();
          return {
            busy: false,
            ignored: false,
            mailboxId,
            pubSubMessageId: body.pubSubMessageId,
          };
        }
      );

      await processGmailQueueMessage(body, env, { processNotification });

      expect(processNotification).toHaveBeenCalledExactlyOnceWith(body);
    });

    test("retries a notification when the mailbox is busy", async () => {
      const processNotification = vi
        .fn<typeof processGmailPubSubNotification>()
        .mockResolvedValue({
          busy: true,
          ignored: false,
          mailboxId,
          pubSubMessageId: body.pubSubMessageId,
        });
      await expect(
        processGmailQueueMessage(body, env, { processNotification })
      ).resolves.toStrictEqual({ retry: true });
    });

    test("retries maintenance while the mailbox is busy", async () => {
      const maintainMailbox = vi
        .fn<typeof maintainGmailPubSubMailbox>()
        .mockResolvedValue({ status: "busy" });
      await expect(
        processGmailQueueMessage(
          { emailAddress, mailboxId, type: "maintenance" },
          env,
          { maintainMailbox }
        )
      ).resolves.toStrictEqual({ retry: true });
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
});
