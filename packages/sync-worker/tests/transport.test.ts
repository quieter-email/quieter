import { once } from "node:events";

import type { SyncBatch } from "@quieter/sync";
import { createSyncTicket } from "@quieter/sync-server/auth";
import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vite-plus/test";

import worker from "../src/worker";

const fixtures = vi.hoisted(() => ({
  authorize: vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
  }),
  epoch: "3595c675-0d6f-41ad-a78c-349fbd65e3c3",
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Partial adapter replacement avoids loading unrelated application services in workerd.
vi.mock("@quieter/database/client", () => ({
  withRequestDatabaseClient: async (run: () => Promise<unknown>) => await run(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the transport-facing application adapter is exercised here.
vi.mock("@quieter/orpc/mail-sync", () => ({
  authorizeSyncMailbox: fixtures.authorize,
  mailSyncServices: () => ({
    repository: {
      head: async () => {
        await Promise.resolve();
        return { epoch: fixtures.epoch, sequence: "0" };
      },
    },
  }),
  maintainMailSynchronization: vi.fn<() => Promise<void>>(),
  runMailboxSynchronization: vi.fn<() => Promise<{ hasMore: boolean }>>(),
  withMailSyncRuntime: async (_runtime: unknown, run: () => Promise<unknown>) =>
    await run(),
}));

const secret = "test-mail-sync-secret-at-least-32-bytes";
const connect = async (userId: string) => {
  const response = await worker.fetch(
    new Request(
      `https://sync.invalid/connect?ticket=${createSyncTicket(userId, secret)}`,
      { headers: { upgrade: "websocket" } }
    ),
    env
  );
  if (response.webSocket === null) {
    throw new Error("Expected a WebSocket.");
  }
  response.webSocket.accept();
  return response.webSocket;
};
const nextMessage = async (socket: WebSocket) => {
  const events: unknown[] = await once(socket, "message", {
    signal: AbortSignal.timeout(5000),
  });
  const [event] = events;
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    throw new Error("Expected a text frame.");
  }
  return JSON.parse(event.data) as unknown;
};

describe("durable mail transport", () => {
  it("rejects missing tickets and unauthenticated internal delivery", async () => {
    const connectResponse = await worker.fetch(
      new Request("https://sync.invalid/connect"),
      env
    );
    const delivery = await worker.fetch(
      new Request("https://sync.invalid/internal/batch", {
        body: "{}",
        method: "POST",
      }),
      env
    );
    expect(connectResponse.status).toBe(401);
    expect(delivery.status).toBe(401);
  });

  it("restores subscriptions after hibernation and delivers the exact committed batch", async () => {
    const userId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const generation = crypto.randomUUID();
    const socket = await connect(userId);
    const resumed = nextMessage(socket);
    socket.send(
      JSON.stringify({
        checkpoint: { epoch: fixtures.epoch, sequence: "0" },
        generation,
        mailboxId,
        protocol: 1,
        type: "RESUME",
      })
    );
    await expect(resumed).resolves.toMatchObject({ generation, type: "HEAD" });
    await evictDurableObject(env.UserSyncObjects.getByName(userId));
    await evictDurableObject(env.MailboxSyncObjects.getByName(mailboxId));
    const batch: SyncBatch = {
      changes: [
        {
          data: { kind: "label", value: { id: "work", name: "Work" } },
          id: "work",
          kind: "label",
          version: "1",
        },
      ],
      epoch: fixtures.epoch,
      mailboxId,
      protocol: 1,
      sequence: "1",
    };
    const delivered = nextMessage(socket);
    await env.MailboxSyncObjects.getByName(mailboxId).publish(batch);
    await expect(delivered).resolves.toStrictEqual({
      batch,
      generation,
      type: "PATCH",
    });
    socket.send(
      JSON.stringify({
        checkpoint: { epoch: fixtures.epoch, sequence: "1" },
        generation,
        mailboxId,
        type: "ACK",
      })
    );
    const revoked = nextMessage(socket);
    await env.UserSyncObjects.getByName(userId).revoke(mailboxId);
    await expect(revoked).resolves.toStrictEqual({
      generation,
      mailboxId,
      type: "REVOKED",
    });
    socket.close();
  });

  it("coalesces wakeups without losing notifications that arrive during work", async () => {
    const mailboxId = crypto.randomUUID();
    const object = env.MailboxSyncObjects.getByName(mailboxId);
    await object.wake(mailboxId);
    const generation = await object.beginWork();
    if (generation === null) {
      throw new Error("Missing work generation.");
    }
    await object.wake(mailboxId);
    await object.finishWork(generation, false);
    await evictDurableObject(object);
    const newer = await object.beginWork();
    expect(newer).toBe(generation + 1);
    await object.finishWork(generation + 1, false);
    await expect(object.beginWork()).resolves.toBeNull();
    await expect(runDurableObjectAlarm(object)).resolves.toBeFalsy();
  });
});
