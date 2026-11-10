import { processGmailPubSubNotification } from "@quieter/orpc/gmail-pubsub";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { processGmailQueue } from "../src/gmail-processing";
import type { broadcastGmailUpdate } from "../src/mail-updates";

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Keep request-scoped processing without opening an external database in queue transport tests.
    withRequestDatabaseClient: async (callback) => await callback(original.db),
  };
});

vi.mock(import("@quieter/orpc/gmail-pubsub"), () => ({
  processGmailPubSubNotification:
    vi.fn<typeof processGmailPubSubNotification>(),
}));

vi.mock(import("../src/mail-updates"), () => ({
  broadcastGmailUpdate: vi.fn<typeof broadcastGmailUpdate>(async () => {
    await Promise.resolve();
  }),
}));

const notification = {
  emailAddress: "queue@example.invalid",
  historyId: "123",
  pubSubMessageId: "delivery-1",
};

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

describe("durable Gmail processing", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  test("acknowledges completed and duplicate deliveries through the established processor", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue(completed);
    const first = delivery();
    const duplicate = delivery();
    await processGmailQueue(first.batch, env);
    await processGmailQueue(duplicate.batch, env);
    expect(first.message.ack).toHaveBeenCalledOnce();
    expect(duplicate.message.ack).toHaveBeenCalledOnce();
    expect(processGmailPubSubNotification).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(processGmailPubSubNotification).mock.calls[0]?.[0]
    ).toMatchObject(notification);
    expect(
      vi.mocked(processGmailPubSubNotification).mock.calls[0]?.[1]?.onAccepted
    ).toBeTypeOf("function");
    expect(first.message.retry).not.toHaveBeenCalled();
    expect(duplicate.message.retry).not.toHaveBeenCalled();
  });

  test("acknowledges ignored deliveries without scheduling more work", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue({
      ignored: true,
      reason: "mailbox_not_connected",
    });
    const send = vi.spyOn(env.GmailProcessingQueue, "send");
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test("leaves leased work retryable instead of acknowledging it", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue({
      ...completed,
      busy: true,
      retryAfterMs: 120_000,
    });
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.retry.mock.calls[0]?.[0]?.delaySeconds).toBeGreaterThan(0);
    expect(message.ack).not.toHaveBeenCalled();
  });

  test("leaves transient failures retryable", async () => {
    vi.mocked(processGmailPubSubNotification).mockRejectedValue(
      new Error("temporary")
    );
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  test("acknowledges continuation only after its successor is durably accepted", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue({
      ...completed,
      needsContinuation: true,
    });
    const pending = Promise.withResolvers<null>();
    const send = vi
      .spyOn(env.GmailProcessingQueue, "send")
      .mockImplementationOnce(async () => {
        await pending.promise;
        return { metadata: { metrics: { backlogBytes: 0, backlogCount: 1 } } };
      });
    const { batch, message } = delivery();
    const processing = processGmailQueue(batch, env);
    await vi.waitFor(() => {
      expect(send.mock.calls[0]?.[0]).toMatchObject(notification);
    });
    expect(message.ack).not.toHaveBeenCalled();
    pending.resolve(null);
    await processing;
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  test("retries the current delivery if continuation enqueue fails", async () => {
    vi.mocked(processGmailPubSubNotification).mockResolvedValue({
      ...completed,
      needsContinuation: true,
    });
    vi.spyOn(env.GmailProcessingQueue, "send").mockRejectedValueOnce(
      new Error("queue unavailable")
    );
    const { batch, message } = delivery();
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  test("keeps malformed internal work visible and retryable for dead-letter handling", async () => {
    const { batch, message } = delivery({ emailAddress: "invalid" });
    await processGmailQueue(batch, env);
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(processGmailPubSubNotification).not.toHaveBeenCalled();
  });
});
