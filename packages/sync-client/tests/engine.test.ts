import "fake-indexeddb/auto";
import { createHash } from "node:crypto";

import { syncMessageSchema } from "@quieter/sync";
import type { SyncBody, SyncCommand, SyncSnapshot } from "@quieter/sync";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { MailSyncEngine } from "../src/engine";
import { ReplicaStorage } from "../src/storage";
import type { SyncApi, SyncClientEvent } from "../src/types";

const body = { bodyText: "Ready before navigation" };
const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
const checkpoint = {
  epoch: "feef45d0-9960-4242-a244-5f54355098a9",
  sequence: "0",
};
const message = syncMessageSchema.parse({
  attachments: [],
  body: { bytes: 32, hash },
  id: "message",
  internalDate: "1000",
  isUnread: false,
  labelIds: ["INBOX"],
  threadId: "thread",
});
const snapshot: SyncSnapshot = {
  checkpoint,
  coverage: { complete: true, kind: "threads", threadIds: ["thread"] },
  entities: [
    {
      data: { kind: "message", value: message },
      id: "message",
      kind: "message",
      version: "0",
    },
    {
      data: {
        kind: "thread",
        value: {
          attachmentCount: 0,
          id: "thread",
          isUnread: false,
          labelIds: ["INBOX"],
          latest: message,
          messageCount: 1,
          messageIds: ["message"],
        },
      },
      id: "thread",
      kind: "thread",
      version: "0",
    },
  ],
  mailboxId: "mailbox",
};
const command: SyncCommand = {
  command: { kind: "set-read", read: true },
  commandId: crypto.randomUUID(),
  mailboxId: "mailbox",
  targets: [{ messageIds: ["message"], threadId: "thread" }],
};
const engines: MailSyncEngine[] = [];
const fixtures = () => {
  const events: SyncClientEvent[] = [];
  const socket = Object.assign(new EventTarget(), {
    close: vi.fn<() => void>(),
    readyState: 0,
    send: vi.fn<(data: string) => void>(),
  });
  // This test double exercises connection ownership without opening a network socket.
  const createSocket = vi.fn<() => WebSocket>(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- EventTarget models only the WebSocket methods used by the connection coordinator.
    () => socket as unknown as WebSocket
  );
  const api: SyncApi = {
    body: vi.fn<SyncApi["body"]>(async () => {
      await Promise.resolve();
      return body;
    }),
    command: vi.fn<SyncApi["command"]>(async () => {
      await Promise.resolve();
      return null;
    }),
    connection: vi.fn<SyncApi["connection"]>(async () => {
      await Promise.resolve();
      return { url: "ws://localhost/fixture" };
    }),
    hydrate: vi.fn<SyncApi["hydrate"]>(async () => {
      await Promise.resolve();
      return snapshot;
    }),
    replay: vi.fn<SyncApi["replay"]>(async () => {
      await Promise.resolve();
      return { batches: [], checkpoint, hasMore: false, reset: false };
    }),
    snapshot: vi.fn<SyncApi["snapshot"]>(async () => {
      await Promise.resolve();
      return snapshot;
    }),
    submit: vi.fn<SyncApi["submit"]>(async (input) => {
      await Promise.resolve();
      return { commandId: input.commandId, error: null, status: "accepted" };
    }),
  };
  return { api, createSocket, events };
};
const start = async (
  setup: ReturnType<typeof fixtures>,
  userId = crypto.randomUUID(),
  persistent = true
) => {
  const engine = await MailSyncEngine.create({
    api: setup.api,
    createSocket: setup.createSocket,
    onEvent: (event) => {
      setup.events.push(event);
    },
    persistent,
    reducedData: true,
    userId,
  });
  engines.push(engine);
  await engine.subscribe(["mailbox"]);
  return engine;
};

describe("mail engine lifecycle", () => {
  afterEach(async () => {
    for (const engine of engines.splice(0)) {
      await engine.stop();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("removes persistent mail on opt-out and preserves accepted commands in memory", async () => {
    const setup = fixtures();
    const userId = crypto.randomUUID();
    const engine = await start(setup, userId);
    await engine.command(command);
    await engine.thread("mailbox", "thread");
    await engine.setPersistence(false);
    expect(engine.status.state.persistent).toBeFalsy();
    const storage = await ReplicaStorage.open(userId);
    await expect(storage.body("mailbox", hash)).resolves.toBeNull();
    await expect(storage.pendingCommands()).resolves.toStrictEqual([]);
    await engine.setPersistence(true);
    await expect(storage.pendingCommands()).resolves.toStrictEqual([command]);
    storage.close();
  });

  it("rejects a body arriving after cache clear and does not persist it", async () => {
    const setup = fixtures();
    const userId = crypto.randomUUID();
    const delayed = Promise.withResolvers<SyncBody>();
    const started = Promise.withResolvers<boolean>();
    setup.api.body = async () => {
      started.resolve(true);
      return await delayed.promise;
    };
    const engine = await start(setup, userId);
    const loading = engine.thread("mailbox", "thread");
    await started.promise;
    await engine.clearCache();
    delayed.resolve(body);
    await expect(loading).rejects.toThrow("aborted");
    const storage = await ReplicaStorage.open(userId);
    await expect(storage.body("mailbox", hash)).resolves.toBeNull();
    storage.close();
  });

  it("notifies other tabs to remove their UI state when the account signs out", async () => {
    const userId = crypto.randomUUID();
    const first = await start(fixtures(), userId);
    const peer = fixtures();
    await start(peer, userId);
    await first.stop(true);
    await vi.waitFor(() => {
      expect(
        peer.events.some((event) => event.type === "session-ended")
      ).toBeTruthy();
    });
  });

  it("renews connection ownership while a command status request is stalled", async () => {
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
    const userId = crypto.randomUUID();
    const owner = fixtures();
    const first = await start(owner, userId);
    const peer = fixtures();
    await start(peer, userId);
    await first.command(command);
    const delayed = Promise.withResolvers<null>();
    owner.api.command = async () => await delayed.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    const observer = await ReplicaStorage.open(userId);
    await expect(observer.claimLeadership("intruder")).resolves.toBeFalsy();
    observer.close();
    expect(owner.createSocket).toHaveBeenCalledOnce();
    expect(peer.createSocket).not.toHaveBeenCalled();
    delayed.resolve(null);
  });
});

describe("mail connection status", () => {
  it("shares the elected tab's connection state without opening another connection", async () => {
    const userId = crypto.randomUUID();
    const api: SyncApi = {
      body: vi.fn<SyncApi["body"]>().mockResolvedValue({}),
      command: vi.fn<SyncApi["command"]>().mockResolvedValue(null),
      connection: vi
        .fn<SyncApi["connection"]>()
        .mockResolvedValue({ url: null }),
      hydrate: vi.fn<SyncApi["hydrate"]>().mockResolvedValue(null),
      replay: vi.fn<SyncApi["replay"]>(),
      snapshot: vi.fn<SyncApi["snapshot"]>().mockResolvedValue(null),
      submit: vi.fn<SyncApi["submit"]>(),
    };
    const leader = await MailSyncEngine.create({
      api,
      onEvent: vi.fn<(event: SyncClientEvent) => void>(),
      userId,
    });
    let follower: MailSyncEngine | null = null;
    try {
      await vi.waitFor(() => {
        expect(leader.status.state.connection).toBe("disabled");
      });
      follower = await MailSyncEngine.create({
        api,
        onEvent: vi.fn<(event: SyncClientEvent) => void>(),
        userId,
      });
      await vi.waitFor(() => {
        expect(follower?.status.state.connection).toBe("disabled");
      });
      expect(api.connection).toHaveBeenCalledOnce();
    } finally {
      await follower?.stop();
      await leader.stop(true);
    }
  });
});
