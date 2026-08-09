import { describe, expect, test } from "vite-plus/test";

import {
  collectVisibleMessageRefreshBatch,
  queueVisibleMessageRefreshIds,
} from "./visible-message-refresh";

describe("visible message refresh batching", () => {
  test("queues visible messages outside the refreshed prefix and caps each batch", () => {
    const queuedMessageIds = new Set<string>();
    const hasQueuedMessage = queueVisibleMessageRefreshIds(
      queuedMessageIds,
      ["hot", "deep-a", "deep-b", "deep-c"],
      new Set(["hot"])
    );

    const batch = collectVisibleMessageRefreshBatch({
      cooldownMs: 1000,
      inFlightMessageIds: new Set(),
      maxBatchSize: 2,
      now: 1000,
      queuedMessageIds,
      recentAttemptByMessageId: new Map(),
      skipMessageIds: new Set(["hot"]),
    });

    expect(hasQueuedMessage).toBeTruthy();
    expect(batch).toStrictEqual(["deep-a", "deep-b"]);
    expect([...queuedMessageIds]).toStrictEqual(["deep-c"]);
  });

  test("does not refetch the same visible message inside the cooldown", () => {
    const queuedMessageIds = new Set<string>();
    const recentAttemptByMessageId = new Map<string, number>();
    const inFlightMessageIds = new Set<string>();

    queueVisibleMessageRefreshIds(queuedMessageIds, ["deep-a"], new Set());
    expect(
      collectVisibleMessageRefreshBatch({
        cooldownMs: 1000,
        inFlightMessageIds,
        maxBatchSize: 25,
        now: 1000,
        queuedMessageIds,
        recentAttemptByMessageId,
        skipMessageIds: new Set(),
      })
    ).toStrictEqual(["deep-a"]);

    inFlightMessageIds.delete("deep-a");
    queueVisibleMessageRefreshIds(queuedMessageIds, ["deep-a"], new Set());

    expect(
      collectVisibleMessageRefreshBatch({
        cooldownMs: 1000,
        inFlightMessageIds,
        maxBatchSize: 25,
        now: 1500,
        queuedMessageIds,
        recentAttemptByMessageId,
        skipMessageIds: new Set(),
      })
    ).toStrictEqual([]);
  });
});
