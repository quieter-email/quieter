import { db } from "@quieter/database/client";
import { recoverUnknownMailAttempts } from "@quieter/database/mail-attempts";
import {
  dispatchMailOutbox,
  recoverQueuedMailOutbox,
} from "@quieter/database/mail-outbox";
import type { MailOutboxEvent } from "@quieter/database/mail-outbox";
import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { publishPendingMailSubmissions } from "../src/mail-submission-publisher-worker.ts";
import { publishMailSubmissionEvent } from "../src/mail-submission-queue.ts";

vi.mock(import("@quieter/database/mail-attempts"), () => ({
  recoverUnknownMailAttempts: vi.fn<typeof recoverUnknownMailAttempts>(),
}));
vi.mock(import("@quieter/database/mail-outbox"), () => ({
  dispatchMailOutbox: vi.fn<typeof dispatchMailOutbox>(),
  recoverQueuedMailOutbox: vi.fn<typeof recoverQueuedMailOutbox>(),
}));

describe("native mail outbox publication", () => {
  const event: MailOutboxEvent = {
    eventType: "submission.dispatch",
    id: crypto.randomUUID(),
    organizationId: "fixture-organization",
    schemaVersion: 1,
    submissionId: crypto.randomUUID(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recoverUnknownMailAttempts).mockResolvedValue(0);
    vi.mocked(recoverQueuedMailOutbox).mockResolvedValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("publishes sending and projection events to their separate native queue bindings", async () => {
    const dispatch = vi.spyOn(env.MailSubmissionDispatchQueue, "send");
    const projection = vi.spyOn(env.MailSubmissionProjectionQueue, "send");
    await expect(publishMailSubmissionEvent(env, event)).resolves.toBe(
      `queue_accepted:${event.id}`
    );
    await publishMailSubmissionEvent(env, {
      ...event,
      eventType: "submission.accepted",
    });
    await publishMailSubmissionEvent(env, {
      ...event,
      eventType: "submission.failed",
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(event, {
      contentType: "json",
    });
    expect(projection).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown schemas before publishing and bounds uncertain queue outcomes", async () => {
    vi.useFakeTimers();
    const dispatch = vi
      .spyOn(env.MailSubmissionDispatchQueue, "send")
      .mockReturnValue(Promise.withResolvers<QueueSendResponse>().promise);
    await expect(
      publishMailSubmissionEvent(env, { ...event, schemaVersion: 2 })
    ).rejects.toThrow("Unsupported durable mail event");
    expect(dispatch).not.toHaveBeenCalled();
    await Promise.all([
      expect(publishMailSubmissionEvent(env, event)).rejects.toThrow(
        "Mail service operation failed"
      ),
      vi.advanceTimersByTimeAsync(10_000),
    ]);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("recovers ledger gaps and bounds one drain before asking for another wakeup", async () => {
    vi.mocked(dispatchMailOutbox).mockResolvedValue({
      claimed: 5,
      deferred: 0,
      published: 5,
    });
    const result = await publishPendingMailSubmissions(db, env, true);
    expect(result).toStrictEqual({ deferred: 0, more: true, published: 60 });
    expect(dispatchMailOutbox).toHaveBeenCalledTimes(12);
    expect(recoverUnknownMailAttempts).toHaveBeenCalledOnce();
    expect(recoverQueuedMailOutbox).toHaveBeenCalledOnce();
  });

  it("stops a failed publication batch without retrying the same uncertain operation in a loop", async () => {
    vi.mocked(dispatchMailOutbox).mockResolvedValue({
      claimed: 5,
      deferred: 1,
      published: 4,
    });
    const result = await publishPendingMailSubmissions(db, env, false);
    expect(result).toStrictEqual({ deferred: 1, more: false, published: 4 });
    expect(dispatchMailOutbox).toHaveBeenCalledOnce();
    expect(recoverUnknownMailAttempts).not.toHaveBeenCalled();
    expect(recoverQueuedMailOutbox).not.toHaveBeenCalled();
  });
});
