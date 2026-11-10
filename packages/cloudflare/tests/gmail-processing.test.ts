import { processGmailPubSubNotification } from "@quieter/orpc/gmail-pubsub";
import {
  discoverFreshGmailMessages,
  processNextGmailMessageWork,
} from "@quieter/orpc/gmail-work";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  enqueueGmailNotification,
  processGmailQueue,
} from "../src/gmail-processing";
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
const fresh = { kind: "work", mailboxId: "mailbox-1", priority: "fresh" };
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
    expect(captureSend).toHaveBeenCalledWith(capture);
    expect(processGmailPubSubNotification).not.toHaveBeenCalled();
    expect(processNextGmailMessageWork).not.toHaveBeenCalled();
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
    const { batch, message } = delivery(fresh);
    const processing = processGmailQueue(batch, env);
    await vi.waitFor(() => {
      expect(broadcastMailUpdate).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          mailboxId: "mailbox-1",
          type: "mailbox.changed",
        })
      );
    });
    expect(message.ack).not.toHaveBeenCalled();
    ancillary.resolve(null);
    await processing;
    expect(message.ack).toHaveBeenCalledOnce();
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
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
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
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    expect(processNextGmailMessageWork).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ mailboxId: "mailbox-1", priority: "fresh" })
    );
    expect(send.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(100);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
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
    const { batch, message } = delivery(fresh);
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
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
