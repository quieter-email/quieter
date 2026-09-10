import { once } from "node:events";

import type { SyncBatch } from "@quieter/sync";
import { createSyncTicket } from "@quieter/sync-server/auth";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vite-plus/test";

import worker from "../src/worker";

const fixtures = vi.hoisted(() => ({
  authorize: vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
  }),
  clientEnabled: vi.fn<() => boolean>(() => true),
  epoch: "3595c675-0d6f-41ad-a78c-349fbd65e3c3",
  session: vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
  }),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Partial adapter replacement avoids loading unrelated application services in workerd.
vi.mock("@quieter/database/client", () => ({
  withRequestDatabaseClient: async (run: () => Promise<unknown>) => await run(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the transport-facing application adapter is exercised here.
vi.mock("@quieter/orpc/mail-sync", () => ({
  authorizeSyncMailbox: fixtures.authorize,
  authorizeSyncSession: fixtures.session,
  isMailSyncClientEnabled: fixtures.clientEnabled,
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
      `https://sync.invalid/connect?ticket=${createSyncTicket(userId, "test-session", secret)}`,
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
  it("answers idle pings through the native auto-response without refreshing access or subscriptions", async () => {
    const userId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const socket = await connect(userId);
    const resumed = nextMessage(socket);
    socket.send(
      JSON.stringify({
        checkpoint: { epoch: fixtures.epoch, sequence: "0" },
        generation: crypto.randomUUID(),
        mailboxId,
        protocol: 1,
        type: "RESUME",
      })
    );
    await resumed;
    const object = env.UserSyncObjects.getByName(userId);
    await runInDurableObject(object, (_instance, state) => {
      state.storage.sql.exec("UPDATE subscriptions SET checkedAt=0");
    });
    fixtures.authorize.mockClear();
    fixtures.session.mockClear();
    await evictDurableObject(object);
    for (let index = 0; index < 8; index += 1) {
      const pong = nextMessage(socket);
      socket.send('{"type":"PING"}');
      await expect(pong).resolves.toStrictEqual({ type: "PONG" });
    }
    expect(fixtures.authorize).not.toHaveBeenCalled();
    expect(fixtures.session).not.toHaveBeenCalled();
    await runInDurableObject(object, (_instance, state) => {
      expect(
        state.getWebSocketAutoResponseTimestamp(state.getWebSockets()[0])
      ).not.toBeNull();
      expect(
        state.storage.sql
          .exec<{ checkedAt: number }>("SELECT checkedAt FROM subscriptions")
          .one().checkedAt
      ).toBe(0);
    });
    socket.close();
  });

  it("renews idle subscriptions on the maintenance alarm and checks a session once across mailboxes", async () => {
    const userId = crypto.randomUUID();
    const socket = await connect(userId);
    const mailboxIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    for (const mailboxId of mailboxIds) {
      const resumed = nextMessage(socket);
      socket.send(
        JSON.stringify({
          checkpoint: { epoch: fixtures.epoch, sequence: "0" },
          generation: crypto.randomUUID(),
          mailboxId,
          protocol: 1,
          type: "RESUME",
        })
      );
      await resumed;
      await runInDurableObject(
        env.MailboxSyncObjects.getByName(mailboxId),
        (_instance, state) => {
          state.storage.sql.exec("UPDATE subscribers SET expiresAt=0");
        }
      );
    }
    fixtures.authorize.mockClear();
    fixtures.session.mockClear();
    const object = env.UserSyncObjects.getByName(userId);
    const recovered: unknown[] = [];
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data === "string") {
        recovered.push(JSON.parse(event.data));
      }
    });
    await evictDurableObject(object);
    await expect(runDurableObjectAlarm(object)).resolves.toBeTruthy();
    expect(fixtures.session).toHaveBeenCalledOnce();
    expect(fixtures.authorize).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => {
      expect(recovered).toHaveLength(3);
      for (const mailboxId of mailboxIds) {
        expect(recovered).toContainEqual(
          expect.objectContaining({ mailboxId, type: "HEAD" })
        );
      }
    });
    for (const mailboxId of mailboxIds) {
      await runInDurableObject(
        env.MailboxSyncObjects.getByName(mailboxId),
        (_instance, state) => {
          expect(
            state.storage.sql
              .exec<{ expiresAt: number }>("SELECT expiresAt FROM subscribers")
              .one().expiresAt
          ).toBeGreaterThan(Date.now() + 240_000);
        }
      );
    }
    await runInDurableObject(object, async (_instance, state) => {
      await expect(state.storage.getAlarm()).resolves.toBeGreaterThan(
        Date.now() + 110_000
      );
    });
    socket.close();
  });

  it("revalidates idle access on the alarm even when only automatic pings arrive", async () => {
    const userId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const socket = await connect(userId);
    const resumed = nextMessage(socket);
    socket.send(
      JSON.stringify({
        checkpoint: { epoch: fixtures.epoch, sequence: "0" },
        generation: crypto.randomUUID(),
        mailboxId,
        protocol: 1,
        type: "RESUME",
      })
    );
    await resumed;
    fixtures.authorize.mockRejectedValueOnce(
      Object.assign(new Error("Access removed"), { code: "FORBIDDEN" })
    );
    const revoked = nextMessage(socket);
    await runDurableObjectAlarm(env.UserSyncObjects.getByName(userId));
    await expect(revoked).resolves.toMatchObject({
      mailboxId,
      type: "REVOKED",
    });
    socket.close();
  });

  it("expires idle sockets and stops scheduling maintenance after they close", async () => {
    const userId = crypto.randomUUID();
    const socket = await connect(userId);
    const object = env.UserSyncObjects.getByName(userId);
    await runInDurableObject(object, (_instance, state) => {
      const [server] = state.getWebSockets();
      server.serializeAttachment({
        createdAt: Date.now() - 16 * 60_000,
        id: crypto.randomUUID(),
        sessionId: "test-session",
        userId,
      });
    });
    const closed = once(socket, "close", { signal: AbortSignal.timeout(5000) });
    await runDurableObjectAlarm(object);
    const events: unknown[] = await closed;
    expect(events[0]).toMatchObject({ code: 1000 });
    await expect(runDurableObjectAlarm(object)).resolves.toBeFalsy();
  });

  it("reconnects on a client rollout rollback without reporting an expired login", async () => {
    const userId = crypto.randomUUID();
    const socket = await connect(userId);
    fixtures.clientEnabled.mockReturnValueOnce(false);
    const closed = once(socket, "close", { signal: AbortSignal.timeout(5000) });
    await runDurableObjectAlarm(env.UserSyncObjects.getByName(userId));
    const events: unknown[] = await closed;
    expect(events[0]).toMatchObject({ code: 1012 });
    fixtures.clientEnabled.mockReturnValueOnce(false);
    const response = await worker.fetch(
      new Request(
        `https://sync.invalid/connect?ticket=${createSyncTicket(userId, "test-session", secret)}`,
        { headers: { upgrade: "websocket" } }
      ),
      env
    );
    expect(response.status).toBe(503);
  });

  it("checks prepared body existence through authenticated native R2 requests", async () => {
    const key = `sync/bodies/${crypto.randomUUID()}/${"a".repeat(64)}`;
    const url = `https://sync.invalid/internal/body?key=${encodeURIComponent(key)}`;
    const headers = { authorization: `Bearer ${secret}` };
    const missing = await worker.fetch(
      new Request(url, { headers, method: "HEAD" }),
      env
    );
    expect(missing.status).toBe(404);
    const saved = await worker.fetch(
      new Request(url, { body: "{}", headers, method: "PUT" }),
      env
    );
    expect(saved.status).toBe(204);
    const present = await worker.fetch(
      new Request(url, { headers, method: "HEAD" }),
      env
    );
    expect(present.status).toBe(204);
    const denied = await worker.fetch(
      new Request(url, { method: "HEAD" }),
      env
    );
    expect(denied.status).toBe(401);
    const removed = await worker.fetch(
      new Request(url, { headers, method: "DELETE" }),
      env
    );
    expect(removed.status).toBe(204);
    const expired = await worker.fetch(
      new Request(url, { headers, method: "HEAD" }),
      env
    );
    expect(expired.status).toBe(404);
  });

  it("rejects a valid ticket after its login session has been revoked", async () => {
    fixtures.session.mockRejectedValueOnce(
      Object.assign(new Error("Session expired"), { code: "UNAUTHORIZED" })
    );
    const response = await worker.fetch(
      new Request(
        `https://sync.invalid/connect?ticket=${createSyncTicket(crypto.randomUUID(), "revoked-session", secret)}`,
        { headers: { upgrade: "websocket" } }
      ),
      env
    );
    expect(response.status).toBe(401);
  });

  it("closes malformed client frames without exposing application failures", async () => {
    const socket = await connect(crypto.randomUUID());
    const closed = once(socket, "close", { signal: AbortSignal.timeout(5000) });
    socket.send("{");
    const events: unknown[] = await closed;
    const [event] = events;
    expect(event).toMatchObject({ code: 1008 });
  });

  it("rechecks revoked grants immediately on a control notification", async () => {
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
    await resumed;
    fixtures.authorize.mockRejectedValueOnce(
      Object.assign(new Error("Access removed"), { code: "FORBIDDEN" })
    );
    const revoked = nextMessage(socket);
    await env.MailboxSyncObjects.getByName(mailboxId).accessChanged();
    await expect(revoked).resolves.toMatchObject({
      generation,
      mailboxId,
      type: "REVOKED",
    });
    socket.close();
  });

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
