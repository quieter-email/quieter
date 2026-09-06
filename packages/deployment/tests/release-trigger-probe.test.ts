import { randomUUID } from "node:crypto";

import type {
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vite-plus/test";

import worker from "../src/release-trigger-probe.ts";

const token = "a".repeat(64);
const bindings = () => ({
  PROBE_GENERATION: "baseline",
  PROBE_QUEUE: { send: vi.fn<() => Promise<void>>().mockResolvedValue() },
  PROBE_RECORDS: {
    get: vi.fn<(key: string) => Promise<null>>().mockResolvedValue(null),
    put: vi
      .fn<(key: string, value: string) => Promise<null>>()
      .mockResolvedValue(null),
  },
  PROBE_TOKEN: token,
  PROBE_VERSION: { id: randomUUID() },
});

describe("release trigger probe", () => {
  it("keeps synthetic publication and evidence private", async () => {
    const env = bindings();
    const response = await worker.fetch(
      new Request("https://fixture.invalid/queue", {
        body: JSON.stringify({ id: randomUUID() }),
        method: "POST",
      }),
      env
    );
    expect(response.status).toBe(404);
    expect(env.PROBE_QUEUE.send).not.toHaveBeenCalled();
  });

  it("acknowledges a queue event only after recording the running version", async () => {
    const env = bindings();
    const id = randomUUID();
    const ack = vi.fn<() => void>();
    const batch: MessageBatch = {
      ackAll: vi.fn<() => void>(),
      messages: [
        {
          ack,
          attempts: 1,
          body: { id },
          id: randomUUID(),
          retry: vi.fn<() => void>(),
          timestamp: new Date(),
        },
      ],
      metadata: { metrics: { backlogBytes: 0, backlogCount: 1 } },
      queue: "fixture",
      retryAll: vi.fn<() => void>(),
    };
    env.PROBE_RECORDS.put.mockRejectedValueOnce(new Error("storage failed"));
    await expect(worker.queue(batch, env)).rejects.toThrow("storage failed");
    expect(ack).not.toHaveBeenCalled();
    await worker.queue(batch, env);
    expect(ack).toHaveBeenCalledOnce();
    expect(env.PROBE_RECORDS.put).toHaveBeenLastCalledWith(
      `queue/${id}`,
      JSON.stringify({
        generation: "baseline",
        id,
        versionId: env.PROBE_VERSION.id,
      })
    );
  });

  it("records the provider's scheduled time and executing version", async () => {
    const env = bindings();
    const event: ScheduledController = {
      cron: "* * * * *",
      noRetry: vi.fn<() => void>(),
      scheduledTime: Date.now(),
    };
    await worker.scheduled(event, env);
    expect(env.PROBE_RECORDS.put).toHaveBeenCalledWith(
      `scheduled/${env.PROBE_VERSION.id}`,
      JSON.stringify({
        generation: "baseline",
        scheduledTime: event.scheduledTime,
        versionId: env.PROBE_VERSION.id,
      })
    );
  });
});
