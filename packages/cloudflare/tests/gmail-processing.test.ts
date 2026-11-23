import { findConnectedGmailMailbox } from "@quieter/orpc/gmail-pubsub";
import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  acceptGmailNotification,
  processGmailQueue,
} from "../src/gmail-processing";
import { GMAIL_PROCESSING_URL } from "../src/gmail-processing-job";
import type { GmailJob } from "../src/gmail-processing-job";
import processingWorker from "../src/gmail-processing-worker";
import type {
  broadcastMailUpdate,
  broadcastGmailUpdate,
} from "../src/mail-updates";

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve request scope without opening an external database in queue transport tests.
    withRequestDatabaseClient: async (callback) => await callback(original.db),
  };
});

vi.mock(import("@quieter/orpc/gmail-pubsub"), () => ({
  findConnectedGmailMailbox: vi.fn<typeof findConnectedGmailMailbox>(),
}));

vi.mock(import("../src/mail-updates"), () => ({
  broadcastGmailUpdate: vi.fn<typeof broadcastGmailUpdate>(async () => {
    await Promise.resolve();
  }),
  broadcastMailUpdate: vi.fn<typeof broadcastMailUpdate>(async () => {
    await Promise.resolve();
  }),
}));

const notification = {
  emailAddress: "queue@example.invalid",
  historyId: "123",
  pubSubMessageId: "delivery-1",
};
const capture = { kind: "capture", notification };
const fresh = {
  kind: "work",
  mailboxId: "mailbox-1",
  priority: "fresh",
} satisfies GmailJob;
const catchup = { ...fresh, priority: "catchup" };
const delivery = (body: unknown = notification) => {
  const message = {
    ack: vi.fn<Message["ack"]>(),
    attempts: 1,
    body,
    id: crypto.randomUUID(),
    retry: vi.fn<Message["retry"]>(),
    timestamp: new Date(),
  } satisfies Message;
  const batch = {
    ackAll: vi.fn<MessageBatch["ackAll"]>(),
    messages: [message],
    metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
    queue: "gmail-processing",
    retryAll: vi.fn<MessageBatch["retryAll"]>(),
  } satisfies MessageBatch;
  return { batch, message };
};

describe("durable Gmail processing", () => {
  beforeEach(() => {
    const scheduler = env.GmailMailboxScheduler.getByName("mailbox-1");
    vi.spyOn(scheduler, "wake").mockResolvedValue();
    vi.spyOn(env.GmailMailboxScheduler, "getByName").mockReturnValue(scheduler);
    vi.spyOn(env.GmailMailboxScheduler, "jurisdiction").mockReturnValue(
      env.GmailMailboxScheduler
    );
    vi.mocked(findConnectedGmailMailbox).mockResolvedValue({
      id: "mailbox-1",
      organizationId: "team-1",
      ownerUserId: "user-1",
      status: "connected",
    });
    vi.spyOn(env.GmailProcessingWorker, "fetch").mockImplementation(
      async (input, init) =>
        await processingWorker.fetch(new Request(input, init), env)
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  test("hands a notification to the mailbox scheduler before acknowledging", async () => {
    await acceptGmailNotification(notification, env);
    const scheduler = env.GmailMailboxScheduler.getByName("mailbox-1");
    expect(scheduler.wake).toHaveBeenCalledOnce();
  });

  test.each([notification, capture, fresh, catchup])(
    "acknowledges an existing queue delivery after the mailbox accepts it",
    async (job) => {
      const scheduler = env.GmailMailboxScheduler.getByName("mailbox-1");
      const { batch, message } = delivery(job);
      await processGmailQueue(batch, env);
      expect(scheduler.wake).toHaveBeenCalledOnce();
      expect(message.ack).toHaveBeenCalledOnce();
    }
  );

  test("keeps malformed work retryable for dead-letter handling", async () => {
    const { batch, message } = delivery({ emailAddress: "invalid" });
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });
});

describe("private Gmail processing transport", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  test("sends job metadata only in bounded POST JSON", async () => {
    const fetch = vi
      .spyOn(env.GmailProcessingWorker, "fetch")
      .mockResolvedValue(Response.json({ action: "ack" }));
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    const [call] = fetch.mock.calls;
    expect(call?.[0]).toBe(GMAIL_PROCESSING_URL);
    expect(call?.[1]).toMatchObject({
      body: JSON.stringify(fresh),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test.each([
    { action: "retry", delaySeconds: 0 },
    { action: "retry", delaySeconds: -1 },
    { action: "retry", delaySeconds: 43_201 },
    { action: "retry", delaySeconds: 1.5 },
    { action: "retry", delaySeconds: "60" },
    { action: "ack", delaySeconds: 60 },
    { action: "unknown" },
  ])("does not acknowledge an invalid decision %j", async (decision) => {
    vi.spyOn(env.GmailProcessingWorker, "fetch").mockResolvedValue(
      Response.json(decision)
    );
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  test.each([
    () => Response.json({ action: "ack" }, { status: 503 }),
    () => new Response("invalid"),
    () => new Response(null, { status: 204 }),
    () => new Response(" ".repeat(2048)),
  ])("keeps failed or unbounded responses retryable", async (response) => {
    vi.spyOn(env.GmailProcessingWorker, "fetch").mockResolvedValue(response());
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  test("keeps binding failures retryable without running work in the consumer", async () => {
    vi.spyOn(env.GmailProcessingWorker, "fetch").mockRejectedValue(
      new Error("service unavailable")
    );
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  test("applies a validated retry decision without acknowledging", async () => {
    vi.spyOn(env.GmailProcessingWorker, "fetch").mockResolvedValue(
      Response.json({ action: "retry", delaySeconds: 123 })
    );
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 123 });
  });

  test("rejects oversized jobs before forwarding", async () => {
    const fetch = vi.spyOn(env.GmailProcessingWorker, "fetch");
    const { batch, message } = delivery({
      ...notification,
      pubSubMessageId: "x".repeat(65_536),
    });
    await processGmailQueue(batch, env);
    expect(fetch).not.toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledOnce();
  });

  test.each([
    new Request(GMAIL_PROCESSING_URL),
    new Request(`${GMAIL_PROCESSING_URL}?mailbox=private`, { method: "POST" }),
    new Request("https://gmail-processing.internal/other", { method: "POST" }),
  ])("rejects methods and private metadata in URLs", async (request) => {
    const response = await processingWorker.fetch(request, env);
    expect(response.status).toBe(404);
  });

  test.each([
    { body: "{", contentType: "application/json" },
    {
      body: JSON.stringify({ emailAddress: "invalid" }),
      contentType: "application/json",
    },
    { body: JSON.stringify(fresh), contentType: "text/plain" },
    { body: " ".repeat(65_537), contentType: "application/json" },
  ])(
    "rejects invalid private input before processing",
    async ({ body, contentType }) => {
      const response = await processingWorker.fetch(
        new Request(GMAIL_PROCESSING_URL, {
          body,
          headers: { "content-type": contentType },
          method: "POST",
        }),
        env
      );
      expect(response.ok).toBeFalsy();
    }
  );

  test("does not return acknowledgement after request cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await processingWorker.fetch(
      new Request(GMAIL_PROCESSING_URL, {
        body: JSON.stringify(catchup),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      }),
      env
    );
    expect(response.ok).toBeFalsy();
  });
});
