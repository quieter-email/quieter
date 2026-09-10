import "fake-indexeddb/auto";
import { createHash } from "node:crypto";

import {
  encodeSyncBatch,
  syncMessageSchema,
  syncServerFrameSchema,
} from "@quieter/sync";
import type { SyncBatch, SyncBody, SyncSnapshot } from "@quieter/sync";
import { describe, expect, it } from "vite-plus/test";

import { SyncFrameAssembler } from "../src/frames";
import { MailboxReplica } from "../src/replica";
import { ReplicaStorage } from "../src/storage";
import type { SyncApi, SyncClientEvent } from "../src/types";

const mailboxId = "mailbox";
const epoch = "fbdc3159-1aa3-4bf0-bb5d-010f07386526";
const buildSnapshot = (text: string, sequence = "0"): SyncSnapshot => {
  const body = { bodyText: text };
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const message = syncMessageSchema.parse({
    attachments: [],
    body: { bytes: text.length, hash },
    id: "message",
    internalDate: "1000",
    isUnread: false,
    labelIds: ["DRAFT"],
    threadId: "thread",
  });
  return {
    checkpoint: { epoch, sequence },
    coverage: { complete: true, kind: "threads", threadIds: ["thread"] },
    entities: [
      {
        data: { kind: "message", value: message },
        id: message.id,
        kind: "message",
        version: sequence,
      },
      {
        data: {
          kind: "thread",
          value: {
            attachmentCount: 0,
            id: "thread",
            isUnread: false,
            labelIds: ["DRAFT"],
            latest: message,
            messageCount: 1,
            messageIds: [message.id],
          },
        },
        id: "thread",
        kind: "thread",
        version: sequence,
      },
    ],
    mailboxId,
  };
};

describe("browser replica races", () => {
  it("reconstructs split Unicode batches and rejects mixed transfer identity", () => {
    const batch: SyncBatch = {
      changes: [
        {
          data: {
            kind: "label",
            value: { id: "label", name: "📨".repeat(100_000) },
          },
          id: "label",
          kind: "label",
          version: "1",
        },
      ],
      epoch,
      mailboxId,
      protocol: 1,
      sequence: "1",
    };
    const assembler = new SyncFrameAssembler();
    const generation = crypto.randomUUID();
    const frames = encodeSyncBatch(batch, generation);
    let result: ReturnType<typeof assembler.accept> = null;
    for (const frame of frames.toReversed()) {
      result = assembler.accept(frame) ?? result;
    }
    expect(result).toStrictEqual({ batch, generation, type: "PATCH" });
    const transfer = syncServerFrameSchema.parse(JSON.parse(frames[0]));
    expect(() =>
      assembler.accept(JSON.stringify({ ...transfer, index: 300 }))
    ).toThrow("Invalid sync fragment");
  });

  it("uses warmed bodies without a second request and replaces a body changed during loading", async () => {
    const storage = await ReplicaStorage.open(crypto.randomUUID());
    const initial = buildSnapshot("Old draft");
    const updated = buildSnapshot("New draft", "1");
    const delayed = Promise.withResolvers<SyncBody>();
    const started = Promise.withResolvers<boolean>();
    let requests = 0;
    let snapshots = 0;
    const events: SyncClientEvent[] = [];
    const controller = new AbortController();
    const api: SyncApi = {
      body: async () => {
        requests += 1;
        if (requests === 1) {
          started.resolve(true);
          return await delayed.promise;
        }
        return { bodyText: "New draft" };
      },
      command: async () => {
        await Promise.resolve();
        return null;
      },
      connection: async () => {
        await Promise.resolve();
        return { url: "wss://sync.invalid/connect" };
      },
      hydrate: async () => {
        await Promise.resolve();
        return initial;
      },
      replay: async () => {
        await Promise.resolve();
        return {
          batches: [],
          checkpoint: initial.checkpoint,
          hasMore: false,
          reset: false,
        };
      },
      snapshot: async () => {
        await Promise.resolve();
        snapshots += 1;
        return snapshots === 1 ? null : initial;
      },
      submit: async (command) => {
        await Promise.resolve();
        return { commandId: command.commandId, error: null, status: "applied" };
      },
    };
    const replica = new MailboxReplica({
      api,
      bodyCache: new Map(),
      mailboxId,
      notify: (event) => {
        events.push(event);
      },
      signal: controller.signal,
      storage,
    });
    try {
      await expect(replica.reset()).rejects.toMatchObject({
        code: "SYNC_NOT_READY",
      });
      expect(replica.checkpoint).toBeNull();
      expect(events.some((event) => event.type === "entities")).toBeFalsy();
      await replica.reset();
      const loading = replica.thread("thread");
      const concurrent = replica.thread("thread");
      await started.promise;
      await expect(replica.messageIds("thread")).resolves.toStrictEqual([
        "message",
      ]);
      expect(requests).toBe(1);
      await replica.apply({
        changes: updated.entities,
        epoch,
        mailboxId,
        protocol: 1,
        sequence: "1",
      });
      delayed.resolve({ bodyText: "Old draft" });
      const loaded = await loading;
      await expect(concurrent).resolves.toStrictEqual(loaded);
      expect(loaded.messages[0].bodyText).toBe("New draft");
      await replica.thread("thread");
      expect(requests).toBe(2);
      expect(events.filter((event) => event.type === "thread")).toHaveLength(2);
    } finally {
      controller.abort();
      storage.close();
    }
  });

  it("rejects late body writes after logout begins", async () => {
    const userId = crypto.randomUUID();
    const storage = await ReplicaStorage.open(userId);
    const body = { bodyText: "Private mail" };
    const hash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    const writing = storage.putBody(mailboxId, hash, body);
    const purging = storage.shutdownAndPurge();
    await expect(writing).rejects.toThrow("closed");
    await purging;
    const reopened = await ReplicaStorage.open(userId);
    try {
      await expect(reopened.body(mailboxId, hash)).resolves.toBeNull();
    } finally {
      reopened.close();
    }
  });
});
