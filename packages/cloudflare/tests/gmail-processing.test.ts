import { processGmailPubSubNotification } from "@quieter/orpc/gmail-pubsub";
import {
  discoverFreshGmailMessages,
  getGmailMessageWorkWake,
  processNextGmailMessageWork,
} from "@quieter/orpc/gmail-work";
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
  enqueueGmailNotification,
  processGmailQueue,
} from "../src/gmail-processing";
import {
  GMAIL_PROCESSING_URL,
  processGmailJob,
} from "../src/gmail-processing-job";
import type { GmailJob } from "../src/gmail-processing-job";
import processingWorker from "../src/gmail-processing-worker";
import { broadcastMailUpdate } from "../src/mail-updates";
import type { broadcastGmailUpdate } from "../src/mail-updates";

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve request scope without opening an external database in queue transport tests.
    withRequestDatabaseClient: async (callback) => await callback(original.db),
  };
});

vi.mock(import("@quieter/orpc/gmail-pubsub"), () => ({
  processGmailPubSubNotification:
    vi.fn<typeof processGmailPubSubNotification>(),
}));

vi.mock(import("@quieter/orpc/gmail-work"), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverFreshGmailMessages: vi.fn<typeof discoverFreshGmailMessages>(),
  getGmailMessageWorkWake: vi.fn<typeof getGmailMessageWorkWake>(),
  processNextGmailMessageWork: vi.fn<typeof processNextGmailMessageWork>(),
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
const completed = {
  busy: false,
  ignored: false as const,
  mailboxId: "mailbox-1",
  needsContinuation: false,
  pubSubMessageId: notification.pubSubMessageId,
};

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

const accepted = {
  metadata: { metrics: { backlogBytes: 0, backlogCount: 1 } },
};

describe("durable Gmail processing", () => {
  beforeEach(() => {
    const executor = env.GmailFreshExecutor.getByName("test-acceptance");
    vi.spyOn(executor, "wake").mockResolvedValue();
    vi.spyOn(env.GmailFreshExecutor, "getByName").mockReturnValue(executor);
    vi.spyOn(env.GmailFreshExecutor, "jurisdiction").mockReturnValue(
      env.GmailFreshExecutor
    );
    vi.mocked(getGmailMessageWorkWake).mockResolvedValue({
      moreReady: true,
      nextWakeAt: new Date(),
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

  test("records notification acceptance before durable intake", async () => {
    const send = vi
      .spyOn(env.GmailProcessingQueue, "send")
      .mockResolvedValue(accepted);
    await enqueueGmailNotification(notification, env);
    const parsed = send.mock.calls[0]?.[0];
    expect(parsed).toMatchObject(notification);
    expect(parsed).toHaveProperty("notificationReceivedAt", expect.any(Number));
  });

  test("discovers legacy notifications without capture or AI execution on intake", async () => {
    vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
      ignored: false,
      mailboxId: "mailbox-1",
      queued: 1,
    });
    const freshSend = vi
      .spyOn(env.GmailFreshProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const captureSend = vi
      .spyOn(env.GmailCatchupProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(discoverFreshGmailMessages).toHaveBeenCalledWith(notification);
    expect(freshSend).toHaveBeenCalledWith(fresh, undefined);
    expect(captureSend).toHaveBeenCalledWith(capture, undefined);
    expect(processGmailPubSubNotification).not.toHaveBeenCalled();
    expect(processNextGmailMessageWork).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("preserves the receive time through the private processing boundary", async () => {
    vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
      ignored: true,
      reason: "mailbox_not_connected",
    });
    const received = { ...notification, notificationReceivedAt: Date.now() };
    const { batch, message } = delivery(received);
    await processGmailQueue(batch, env);
    expect(discoverFreshGmailMessages).toHaveBeenCalledWith(received);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("does not acknowledge discovery until capture handoff is durable", async () => {
    vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
      ignored: false,
      mailboxId: "mailbox-1",
      queued: 0,
    });
    vi.spyOn(env.GmailFreshProcessingQueue, "send").mockResolvedValue(accepted);
    const pending = Promise.withResolvers<null>();
    const send = vi
      .spyOn(env.GmailCatchupProcessingQueue, "send")
      .mockImplementationOnce(async () => {
        await pending.promise;
        return accepted;
      });
    const { batch, message } = delivery();
    const processing = processGmailQueue(batch, env);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce();
    });
    expect(message.ack).not.toHaveBeenCalled();
    pending.resolve(null);
    await processing;
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("starts independent fresh wakeups for messages discovered together", async () => {
    vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
      ignored: false,
      mailboxId: "mailbox-1",
      queued: 3,
    });
    const send = vi
      .spyOn(env.GmailFreshProcessingQueue, "send")
      .mockResolvedValue(accepted);
    vi.spyOn(env.GmailCatchupProcessingQueue, "send").mockResolvedValue(
      accepted
    );
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(send.mock.calls.length).toBeGreaterThan(1);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test.each([0, 3])(
    "still publishes capture when discovery lists %i messages but no unfinished fresh work",
    async (queued) => {
      vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
        ignored: false,
        mailboxId: "mailbox-1",
        queued,
      });
      vi.mocked(getGmailMessageWorkWake).mockResolvedValue({
        moreReady: false,
        nextWakeAt: null,
      });
      const freshSend = vi.spyOn(env.GmailFreshProcessingQueue, "send");
      const captureSend = vi
        .spyOn(env.GmailCatchupProcessingQueue, "send")
        .mockResolvedValue(accepted);
      const { batch, message } = delivery();
      await processGmailQueue(batch, env);
      expect(freshSend).not.toHaveBeenCalled();
      expect(captureSend).toHaveBeenCalledWith(capture, undefined);
      expect(message.ack).toHaveBeenCalledOnce();
    }
  );

  test("leaves one durable future wake when discovery has deferred work", async () => {
    vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
      ignored: false,
      mailboxId: "mailbox-1",
      queued: 3,
    });
    vi.mocked(getGmailMessageWorkWake).mockResolvedValue({
      moreReady: false,
      nextWakeAt: new Date(Date.now() + 120_000),
    });
    const pending = Promise.withResolvers<null>();
    const send = vi
      .spyOn(env.GmailFreshProcessingQueue, "send")
      .mockImplementation(async () => {
        await pending.promise;
        return accepted;
      });
    vi.spyOn(env.GmailCatchupProcessingQueue, "send").mockResolvedValue(
      accepted
    );
    const { batch, message } = delivery();
    const processing = processGmailQueue(batch, env);
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce();
    });
    expect(send.mock.calls[0]?.[0]).toMatchObject(fresh);
    expect(send.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(0);
    expect(message.ack).not.toHaveBeenCalled();
    pending.resolve(null);
    await processing;
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test.each(["read", "immediate send", "delayed send", "partial fan-out"])(
    "keeps discovery retryable after a failed readiness %s",
    async (failure) => {
      vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
        ignored: false,
        mailboxId: "mailbox-1",
        queued: 3,
      });
      const error = new Error("scheduling unavailable");
      if (failure === "read") {
        vi.mocked(getGmailMessageWorkWake).mockRejectedValueOnce(error);
      } else if (failure === "delayed send") {
        vi.mocked(getGmailMessageWorkWake).mockResolvedValue({
          moreReady: false,
          nextWakeAt: new Date(Date.now() + 120_000),
        });
      }
      const freshSend = vi
        .spyOn(env.GmailFreshProcessingQueue, "send")
        .mockRejectedValue(error);
      if (failure === "partial fan-out") {
        freshSend.mockResolvedValueOnce(accepted);
      }
      vi.spyOn(env.GmailCatchupProcessingQueue, "send").mockResolvedValue(
        accepted
      );
      const { batch, message } = delivery();
      await processGmailQueue(batch, env);
      expect(message.retry).toHaveBeenCalledOnce();
      expect(message.ack).not.toHaveBeenCalled();
    }
  );

  test("broadcasts critical results before ancillary work finishes", async () => {
    const ancillary = Promise.withResolvers<null>();
    vi.mocked(processNextGmailMessageWork).mockImplementationOnce(
      async (input) => {
        await input.onCriticalComplete?.({
          autoLabelMs: 1,
          notificationToCriticalMs: null,
          queueMs: 1,
          totalMs: 1,
          verificationCodeMs: 1,
        });
        await ancillary.promise;
        return {
          mailboxId: "mailbox-1",
          moreReady: false,
          nextWakeAt: null,
          status: "complete",
        };
      }
    );
    let finished = false;
    const processing = processGmailJob(fresh, env).then((decision) => {
      finished = true;
      return decision;
    });
    await vi.waitFor(() => {
      expect(broadcastMailUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mailboxId: "mailbox-1",
          type: "mailbox.changed",
        })
      );
    });
    expect(finished).toBeFalsy();
    ancillary.resolve(null);
    await expect(processing).resolves.toMatchObject({ action: "ack" });
  });

  test("retries discovery if either durable handoff fails", async () => {
    vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
      ignored: false,
      mailboxId: "mailbox-1",
      queued: 1,
    });
    vi.spyOn(env.GmailFreshProcessingQueue, "send").mockResolvedValue(accepted);
    vi.spyOn(env.GmailCatchupProcessingQueue, "send").mockRejectedValueOnce(
      new Error("queue unavailable")
    );
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  test("continues message processing when the critical UI broadcast fails", async () => {
    vi.mocked(broadcastMailUpdate).mockRejectedValueOnce(
      new Error("broadcast unavailable")
    );
    vi.mocked(processNextGmailMessageWork).mockImplementationOnce(
      async (input) => {
        await input.onCriticalComplete?.({
          autoLabelMs: 1,
          notificationToCriticalMs: null,
          queueMs: 1,
          totalMs: 1,
          verificationCodeMs: 1,
        });
        return {
          mailboxId: "mailbox-1",
          moreReady: false,
          nextWakeAt: null,
          status: "complete",
        };
      }
    );
    await expect(processGmailJob(fresh, env)).resolves.toMatchObject({
      action: "ack",
    });
  });

  test("acknowledges disconnected deliveries without scheduling work", async () => {
    vi.mocked(discoverFreshGmailMessages).mockResolvedValue({
      ignored: true,
      reason: "mailbox_not_connected",
    });
    const send = vi.spyOn(env.GmailFreshProcessingQueue, "send");
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  test("keeps canonical capture leased work retryable", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue({
      ...completed,
      busy: true,
      retryAfterMs: 120_000,
    });
    vi.spyOn(env.GmailCatchupProcessingQueue, "send").mockResolvedValue(
      accepted
    );
    const { batch, message } = delivery(capture);
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.retry.mock.calls[0]?.[0]?.delaySeconds).toBeGreaterThan(0);
    expect(message.ack).not.toHaveBeenCalled();
  });

  test("durably continues capture and wakes per-message catchup work", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue({
      ...completed,
      needsContinuation: true,
    });
    const send = vi
      .spyOn(env.GmailCatchupProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const freshSend = vi
      .spyOn(env.GmailFreshProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const { batch, message } = delivery(capture);
    await processGmailQueue(batch, env);
    expect(send).toHaveBeenCalledWith(catchup, undefined);
    expect(send).toHaveBeenCalledWith(capture, expect.anything());
    expect(freshSend).toHaveBeenCalledWith(fresh, undefined);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("preserves capture continuation without waking completed work", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue({
      ...completed,
      needsContinuation: true,
    });
    vi.mocked(getGmailMessageWorkWake).mockResolvedValue({
      moreReady: false,
      nextWakeAt: null,
    });
    const freshSend = vi.spyOn(env.GmailFreshProcessingQueue, "send");
    const catchupSend = vi
      .spyOn(env.GmailCatchupProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const { batch, message } = delivery(capture);
    await processGmailQueue(batch, env);
    expect(freshSend).not.toHaveBeenCalled();
    expect(catchupSend).toHaveBeenCalledExactlyOnceWith(
      capture,
      expect.anything()
    );
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("schedules capture priorities independently when only catchup is ready", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue(completed);
    vi.mocked(getGmailMessageWorkWake).mockImplementation(
      async (input) =>
        await Promise.resolve({
          moreReady: input.priority === "catchup",
          nextWakeAt: input.priority === "catchup" ? new Date() : null,
        })
    );
    const freshSend = vi.spyOn(env.GmailFreshProcessingQueue, "send");
    const catchupSend = vi
      .spyOn(env.GmailCatchupProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const { batch, message } = delivery(capture);
    await processGmailQueue(batch, env);
    expect(freshSend).not.toHaveBeenCalled();
    expect(catchupSend).toHaveBeenCalledWith(catchup, undefined);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("leaves one delayed wake for each deferred capture priority", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue(completed);
    vi.mocked(getGmailMessageWorkWake).mockResolvedValue({
      moreReady: false,
      nextWakeAt: new Date(Date.now() + 120_000),
    });
    const freshSend = vi
      .spyOn(env.GmailFreshProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const catchupSend = vi
      .spyOn(env.GmailCatchupProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const { batch, message } = delivery(capture);
    await processGmailQueue(batch, env);
    expect(freshSend).toHaveBeenCalledOnce();
    expect(catchupSend).toHaveBeenCalledOnce();
    expect(freshSend.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(0);
    expect(catchupSend.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(0);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("keeps capture retryable when a delayed wake fails", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue(completed);
    vi.mocked(getGmailMessageWorkWake).mockResolvedValue({
      moreReady: false,
      nextWakeAt: new Date(Date.now() + 120_000),
    });
    vi.spyOn(env.GmailFreshProcessingQueue, "send").mockResolvedValue(accepted);
    vi.spyOn(env.GmailCatchupProcessingQueue, "send").mockRejectedValueOnce(
      new Error("queue unavailable")
    );
    const { batch, message } = delivery(capture);
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  test("honors the mailbox provider cooldown before retrying discovery", async () => {
    vi.mocked(discoverFreshGmailMessages).mockRejectedValueOnce(
      Object.assign(new Error("Provider throttled"), {
        retryAfterMs: 120_000,
        status: 429,
      })
    );
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledWith(
      expect.objectContaining({ delaySeconds: 120 })
    );
    expect(message.ack).not.toHaveBeenCalled();
  });

  test("runs one fresh message and keeps deferred work durable at its due time", async () => {
    const nextWakeAt = new Date(Date.now() + 120_000);
    vi.mocked(processNextGmailMessageWork).mockResolvedValue({
      mailboxId: "mailbox-1",
      moreReady: false,
      nextWakeAt,
      status: "retry",
    });
    const send = vi
      .spyOn(env.GmailFreshProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const decision = await processGmailJob(fresh, env);
    expect(processNextGmailMessageWork).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ mailboxId: "mailbox-1", priority: "fresh" })
    );
    expect(send.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(100);
    expect(decision).toMatchObject({ action: "ack" });
  });

  test("does not acknowledge message work until its future wake is durable", async () => {
    vi.mocked(processNextGmailMessageWork).mockResolvedValue({
      mailboxId: "mailbox-1",
      moreReady: true,
      nextWakeAt: new Date(),
      status: "complete",
    });
    vi.spyOn(env.GmailFreshProcessingQueue, "send").mockRejectedValueOnce(
      new Error("queue unavailable")
    );
    await expect(processGmailJob(fresh, env)).resolves.toMatchObject({
      action: "retry",
    });
  });

  test("retries capacity wake publication failure and durably rescues its replay", async () => {
    vi.mocked(processNextGmailMessageWork).mockResolvedValue({
      activeLeases: 4,
      moreReady: false,
      nextWakeAt: new Date(Date.now() - 1000),
      status: "capacity_busy",
    });
    const send = vi
      .spyOn(env.GmailFreshProcessingQueue, "send")
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValue(accepted);
    await expect(processGmailJob(fresh, env)).resolves.toMatchObject({
      action: "retry",
    });
    const replay = await processGmailJob(fresh, env);
    expect(send.mock.calls.at(-1)?.[1]?.delaySeconds).toBeGreaterThan(0);
    expect(replay).toMatchObject({ action: "ack" });
    expect(broadcastMailUpdate).not.toHaveBeenCalled();
  });

  test("rechecks very distant work within the queue delay limit", async () => {
    vi.mocked(processNextGmailMessageWork).mockResolvedValue({
      moreReady: false,
      nextWakeAt: new Date(Date.now() + 86_400_000),
      status: "idle",
    });
    const send = vi
      .spyOn(env.GmailCatchupProcessingQueue, "send")
      .mockResolvedValue(accepted);
    const { batch, message } = delivery(catchup);
    await processGmailQueue(batch, env);
    expect(send.mock.calls[0]?.[1]?.delaySeconds).toBeLessThan(86_400);
    expect(send.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(0);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  test("keeps malformed work retryable for dead-letter handling", async () => {
    const { batch, message } = delivery({ emailAddress: "invalid" });
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(processNextGmailMessageWork).not.toHaveBeenCalled();
    expect(processGmailPubSubNotification).not.toHaveBeenCalled();
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
    expect(processNextGmailMessageWork).not.toHaveBeenCalled();
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
    expect(processNextGmailMessageWork).not.toHaveBeenCalled();
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
      expect(processNextGmailMessageWork).not.toHaveBeenCalled();
      expect(processGmailPubSubNotification).not.toHaveBeenCalled();
    }
  );

  test("does not return acknowledgement after request cancellation", async () => {
    const pending = Promise.withResolvers<null>();
    vi.mocked(processNextGmailMessageWork).mockImplementationOnce(async () => {
      await pending.promise;
      return { moreReady: false, nextWakeAt: null, status: "idle" };
    });
    const controller = new AbortController();
    const processing = processingWorker.fetch(
      new Request(GMAIL_PROCESSING_URL, {
        body: JSON.stringify(catchup),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      }),
      env
    );
    await vi.waitFor(() => {
      expect(processNextGmailMessageWork).toHaveBeenCalledOnce();
    });
    controller.abort();
    pending.resolve(null);
    const response = await processing;
    expect(response.ok).toBeFalsy();
  });
});
