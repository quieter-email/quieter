import {
  syncChangeSchema,
  syncCheckpointSchema,
  syncCommandSchema,
} from "@quieter/sync";
import type {
  SyncBatch,
  SyncBody,
  SyncChange,
  SyncCheckpoint,
  SyncCommand,
  SyncSnapshot,
} from "@quieter/sync";
import { classifySyncBatch, reconcileSyncRange } from "@quieter/sync/replica";
import { z } from "zod";

import { requestResult, runTransaction } from "./indexed-db";

const entitySchema = syncChangeSchema.and(
  z.object({
    bytes: z.number(),
    mailboxId: z.string(),
    threadId: z.string().nullable(),
    touchedAt: z.number(),
  })
);
const bodyIndexSchema = z.object({
  bytes: z.number(),
  encoding: z.enum(["gzip", "identity"]),
  hash: z.string(),
  mailboxId: z.string(),
  touchedAt: z.number(),
});
const checkpointSchema = z.object({
  checkpoint: syncCheckpointSchema,
  mailboxId: z.string(),
});
const stores = [
  "entities",
  "checkpoints",
  "coverage",
  "bodies",
  "bodyIndex",
  "commands",
  "settings",
];

const writeChanges = async (
  transaction: IDBTransaction,
  mailboxId: string,
  changes: readonly SyncChange[]
) => {
  const entities = transaction.objectStore("entities");
  for (const change of changes) {
    const previousValue = await requestResult(
      entities.get([mailboxId, change.kind, change.id])
    );
    const previous =
      previousValue === undefined ? null : entitySchema.parse(previousValue);
    if (
      previous !== null &&
      BigInt(previous.version) >= BigInt(change.version)
    ) {
      continue;
    }
    let threadId = previous?.threadId ?? null;
    if (change.data?.kind === "message" || change.data?.kind === "delivery") {
      ({ threadId } = change.data.value);
    }
    if (change.data?.kind === "thread") {
      threadId = change.data.value.id;
    }
    entities.put({
      ...change,
      bytes: new TextEncoder().encode(JSON.stringify(change)).byteLength,
      mailboxId,
      threadId,
      touchedAt: Date.now(),
    });
  }
};

export class ReplicaStorage {
  private readonly database: IDBDatabase;
  private closed = false;
  private generation: string | null = null;
  private constructor(database: IDBDatabase) {
    this.database = database;
  }

  static async open(userId: string, factory: IDBFactory = indexedDB) {
    const request = factory.open(`quieter-mail-v1:${userId}`, 1);
    let abandoned = false;
    const unavailable = Promise.withResolvers<never>();
    const timeout = setTimeout(() => {
      unavailable.reject(new Error("Local mail storage did not open in time."));
    }, 5000);
    request.onblocked = () => {
      unavailable.reject(
        new Error("Another tab is blocking the mail cache upgrade.")
      );
    };
    request.addEventListener("success", () => {
      if (abandoned) {
        request.result.close();
      }
    });
    request.onupgradeneeded = () => {
      const database = request.result;
      const entities = database.createObjectStore("entities", {
        keyPath: ["mailboxId", "kind", "id"],
      });
      entities.createIndex("mailbox", "mailboxId");
      entities.createIndex("thread", ["mailboxId", "threadId"]);
      entities.createIndex("touched", "touchedAt");
      database.createObjectStore("checkpoints", { keyPath: "mailboxId" });
      database
        .createObjectStore("coverage", { keyPath: ["mailboxId", "threadId"] })
        .createIndex("mailbox", "mailboxId");
      database.createObjectStore("bodies");
      const bodies = database.createObjectStore("bodyIndex", {
        keyPath: ["mailboxId", "hash"],
      });
      bodies.createIndex("mailbox", "mailboxId");
      bodies.createIndex("touched", "touchedAt");
      database
        .createObjectStore("commands", { keyPath: ["mailboxId", "commandId"] })
        .createIndex("mailbox", "mailboxId");
      database.createObjectStore("settings");
    };
    let result: unknown;
    try {
      result = await Promise.race([
        requestResult(request),
        unavailable.promise,
      ]);
    } catch (error) {
      abandoned = true;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!(result instanceof IDBDatabase)) {
      throw new Error("Local mail storage could not be opened.");
    }
    const storage = new ReplicaStorage(result);
    await storage.refreshGeneration();
    result.onversionchange = () => {
      storage.close();
    };
    return storage;
  }

  close() {
    this.closed = true;
    this.database.close();
  }

  private async transact<Result>(
    names: string[],
    mode: IDBTransactionMode,
    run: (transaction: IDBTransaction) => Promise<Result>
  ) {
    if (this.closed) {
      throw new Error("Mail storage was closed.");
    }
    const cacheWrite =
      mode === "readwrite" &&
      names.some((name) => !["commands", "settings"].includes(name));
    return await runTransaction(
      this.database,
      cacheWrite ? [...new Set([...names, "settings"])] : names,
      mode,
      async (transaction) => {
        if (cacheWrite) {
          const current = await requestResult(
            transaction.objectStore("settings").get("cache-generation")
          );
          if ((current ?? null) !== this.generation) {
            throw Object.assign(
              new Error("The mail cache was cleared in another tab."),
              { name: "SyncCacheResetError" }
            );
          }
        }
        return await run(transaction);
      }
    );
  }

  async refreshGeneration() {
    const current = await requestResult(
      this.database
        .transaction("settings")
        .objectStore("settings")
        .get("cache-generation")
    );
    this.generation = current === undefined ? null : z.string().parse(current);
  }

  async shutdownAndPurge() {
    this.closed = true;
    try {
      await this.purge();
    } finally {
      this.database.close();
    }
  }

  async claimLeadership(ownerId: string, now = Date.now()) {
    return await this.transact(
      ["settings"],
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore("settings");
        const raw = await requestResult(store.get("leader"));
        const lease =
          raw === undefined
            ? null
            : z
                .object({ expiresAt: z.number(), ownerId: z.string() })
                .parse(raw);
        if (
          lease !== null &&
          lease.ownerId !== ownerId &&
          lease.expiresAt > now
        ) {
          return false;
        }
        store.put({ expiresAt: now + 20_000, ownerId }, "leader");
        return true;
      }
    );
  }

  async hasCoverage(mailboxId: string, threadId: string) {
    const raw = await requestResult(
      this.database
        .transaction("coverage")
        .objectStore("coverage")
        .get([mailboxId, threadId])
    );
    return raw !== undefined;
  }

  async pendingCommands(mailboxId?: string) {
    const store = this.database.transaction("commands").objectStore("commands");
    const raw = await requestResult(
      mailboxId === undefined
        ? store.getAll()
        : store.index("mailbox").getAll(mailboxId)
    );
    return z
      .array(syncCommandSchema.extend({ localSequence: z.number() }))
      .parse(raw)
      .toSorted((a, b) => a.localSequence - b.localSequence)
      .map((command) => syncCommandSchema.parse(command));
  }

  async cacheBudget(bytes?: number): Promise<number | null> {
    return await this.transact(
      ["settings"],
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore("settings");
        if (bytes !== undefined) {
          store.put(bytes, "budget");
          return bytes;
        }
        const raw = await requestResult(store.get("budget"));
        return raw === undefined
          ? null
          : z
              .number()
              .int()
              .min(10 * 1024 * 1024)
              .max(1024 * 1024 * 1024)
              .parse(raw);
      }
    );
  }

  async checkpoint(mailboxId: string): Promise<SyncCheckpoint | null> {
    const result = await requestResult(
      this.database
        .transaction("checkpoints")
        .objectStore("checkpoints")
        .get(mailboxId)
    );
    return result === undefined
      ? null
      : checkpointSchema.parse(result).checkpoint;
  }

  async load(mailboxId: string) {
    return await this.transact(
      ["checkpoints", "entities"],
      "readonly",
      async (transaction) => {
        const raw = await requestResult(
          transaction.objectStore("checkpoints").get(mailboxId)
        );
        const entities = z
          .array(entitySchema)
          .parse(
            await requestResult(
              transaction
                .objectStore("entities")
                .index("mailbox")
                .getAll(mailboxId)
            )
          );
        return {
          checkpoint:
            raw === undefined ? null : checkpointSchema.parse(raw).checkpoint,
          entities,
        };
      }
    );
  }

  async entities(mailboxId: string, threadId?: string): Promise<SyncChange[]> {
    const store = this.database.transaction("entities").objectStore("entities");
    const records = await requestResult(
      threadId === undefined
        ? store.index("mailbox").getAll(mailboxId)
        : store.index("thread").getAll([mailboxId, threadId])
    );
    return z
      .array(entitySchema)
      .parse(records)
      .map(({ data, id, kind, version }) => ({ data, id, kind, version }));
  }

  async bootstrap(snapshot: SyncSnapshot, expectedEpoch?: string) {
    if (this.closed) {
      throw new Error("Mail storage was closed.");
    }
    return await this.transact(
      ["entities", "checkpoints", "coverage"],
      "readwrite",
      async (transaction) => {
        const raw = await requestResult(
          transaction.objectStore("checkpoints").get(snapshot.mailboxId)
        );
        const current =
          raw === undefined ? null : checkpointSchema.parse(raw).checkpoint;
        if (
          current !== null &&
          ((current.epoch === snapshot.checkpoint.epoch &&
            BigInt(current.sequence) > BigInt(snapshot.checkpoint.sequence)) ||
            (current.epoch !== snapshot.checkpoint.epoch &&
              current.epoch !== expectedEpoch))
        ) {
          return false;
        }
        for (const name of ["entities", "coverage"]) {
          const keys = z
            .array(z.custom<IDBValidKey>())
            .parse(
              await requestResult(
                transaction
                  .objectStore(name)
                  .index("mailbox")
                  .getAllKeys(snapshot.mailboxId)
              )
            );
          for (const key of keys) {
            transaction.objectStore(name).delete(key);
          }
        }
        await writeChanges(transaction, snapshot.mailboxId, snapshot.entities);
        for (const threadId of snapshot.coverage.threadIds) {
          transaction.objectStore("coverage").put({
            checkpoint: snapshot.checkpoint,
            mailboxId: snapshot.mailboxId,
            threadId,
          });
        }
        transaction.objectStore("checkpoints").put({
          checkpoint: snapshot.checkpoint,
          mailboxId: snapshot.mailboxId,
        });
        return true;
      }
    );
  }

  async apply(batch: SyncBatch) {
    if (this.closed) {
      throw new Error("Mail storage was closed.");
    }
    return await this.transact(
      ["entities", "checkpoints", "coverage"],
      "readwrite",
      async (transaction) => {
        const record = await requestResult(
          transaction.objectStore("checkpoints").get(batch.mailboxId)
        );
        const checkpoint =
          record === undefined
            ? null
            : checkpointSchema.parse(record).checkpoint;
        const action = classifySyncBatch(checkpoint, batch);
        if (action !== "apply") {
          return action;
        }
        await writeChanges(transaction, batch.mailboxId, batch.changes);
        transaction.objectStore("checkpoints").put({
          checkpoint: { epoch: batch.epoch, sequence: batch.sequence },
          mailboxId: batch.mailboxId,
        });
        return action;
      }
    );
  }

  async mergeRange(
    snapshot: SyncSnapshot,
    through: SyncCheckpoint,
    intervening: SyncBatch[]
  ) {
    const reconciled = reconcileSyncRange(snapshot, through, intervening);
    return await this.transact(
      ["entities", "checkpoints", "coverage"],
      "readwrite",
      async (transaction) => {
        const raw = await requestResult(
          transaction.objectStore("checkpoints").get(snapshot.mailboxId)
        );
        const current =
          raw === undefined ? null : checkpointSchema.parse(raw).checkpoint;
        if (
          current?.epoch !== through.epoch ||
          current.sequence !== through.sequence
        ) {
          return false;
        }
        // Complete coverage proves that absent entities in this range were deleted.
        for (const threadId of snapshot.coverage.threadIds) {
          const records = z
            .array(entitySchema)
            .parse(
              await requestResult(
                transaction
                  .objectStore("entities")
                  .index("thread")
                  .getAll([snapshot.mailboxId, threadId])
              )
            );
          for (const record of records) {
            if (!reconciled.has(`${record.kind}:${record.id}`)) {
              transaction
                .objectStore("entities")
                .delete([snapshot.mailboxId, record.kind, record.id]);
            }
          }
        }
        await writeChanges(transaction, snapshot.mailboxId, [
          ...reconciled.values(),
        ]);
        for (const threadId of snapshot.coverage.threadIds) {
          transaction.objectStore("coverage").put({
            checkpoint: through,
            mailboxId: snapshot.mailboxId,
            threadId,
          });
        }
        return true;
      }
    );
  }

  async putBody(
    mailboxId: string,
    hash: string,
    body: SyncBody,
    signal?: AbortSignal
  ) {
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
    if (
      [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") !==
      hash
    ) {
      throw new Error("Message content failed its integrity check.");
    }
    const encoding =
      typeof CompressionStream === "undefined" ? "identity" : "gzip";
    const bytes =
      encoding === "gzip"
        ? new Uint8Array(
            await new Response(
              new Blob([raw])
                .stream()
                .pipeThrough(new CompressionStream("gzip"))
            ).arrayBuffer()
          )
        : raw;
    signal?.throwIfAborted();
    await this.transact(
      ["bodies", "bodyIndex"],
      "readwrite",
      async (transaction) => {
        transaction.objectStore("bodies").put(bytes, [mailboxId, hash]);
        transaction.objectStore("bodyIndex").put({
          bytes: bytes.byteLength,
          encoding,
          hash,
          mailboxId,
          touchedAt: Date.now(),
        });
        await Promise.resolve();
      }
    );
  }

  async body(mailboxId: string, hash: string): Promise<SyncBody | null> {
    const stored = await this.transact(
      ["bodies", "bodyIndex"],
      "readwrite",
      async (transaction) => {
        const rawIndex = await requestResult(
          transaction.objectStore("bodyIndex").get([mailboxId, hash])
        );
        if (rawIndex === undefined) {
          return null;
        }
        const index = bodyIndexSchema.parse(rawIndex);
        const bytes = await requestResult(
          transaction.objectStore("bodies").get([mailboxId, hash])
        );
        if (!(bytes instanceof Uint8Array)) {
          throw new Error("Stored message content is invalid.");
        }
        transaction
          .objectStore("bodyIndex")
          .put({ ...index, touchedAt: Date.now() });
        return { bytes, index };
      }
    );
    if (stored === null) {
      return null;
    }
    const stream = new Blob([new Uint8Array(stored.bytes)]).stream();
    const response = new Response(
      stored.index.encoding === "gzip"
        ? stream.pipeThrough(new DecompressionStream("gzip"))
        : stream
    );
    return z
      .object({
        bodyHtml: z.string().optional(),
        bodyText: z.string().optional(),
      })
      .parse(await response.json());
  }

  async enforceBudget(budgetBytes: number, pinnedHashes = new Set<string>()) {
    return await this.transact(
      ["bodies", "bodyIndex", "entities", "coverage"],
      "readwrite",
      async (transaction) => {
        const entries = z
          .array(bodyIndexSchema)
          .parse(
            await requestResult(
              transaction.objectStore("bodyIndex").index("touched").getAll()
            )
          );
        const entities = z
          .array(entitySchema)
          .parse(
            await requestResult(
              transaction.objectStore("entities").index("touched").getAll()
            )
          );
        let used =
          entries.reduce((sum, entry) => sum + entry.bytes, 0) +
          entities.reduce((sum, entry) => sum + entry.bytes, 0);
        for (const entry of entries) {
          if (used <= budgetBytes * 0.85) {
            break;
          }
          if (pinnedHashes.has(`${entry.mailboxId}:${entry.hash}`)) {
            continue;
          }
          transaction
            .objectStore("bodies")
            .delete([entry.mailboxId, entry.hash]);
          transaction
            .objectStore("bodyIndex")
            .delete([entry.mailboxId, entry.hash]);
          used -= entry.bytes;
        }
        const evictedThreads = new Set<string>();
        for (const entry of entities) {
          if (used <= budgetBytes * 0.95) {
            break;
          }
          if (entry.kind !== "message" && entry.kind !== "thread") {
            continue;
          }
          if (
            entry.data?.kind === "message" &&
            entry.data.value.body !== null &&
            pinnedHashes.has(`${entry.mailboxId}:${entry.data.value.body.hash}`)
          ) {
            continue;
          }
          transaction
            .objectStore("entities")
            .delete([entry.mailboxId, entry.kind, entry.id]);
          if (entry.threadId !== null) {
            transaction
              .objectStore("coverage")
              .delete([entry.mailboxId, entry.threadId]);
            evictedThreads.add(`${entry.mailboxId}:${entry.threadId}`);
          }
          used -= entry.bytes;
        }
        return { evictedThreads: [...evictedThreads], used };
      }
    );
  }

  async journal(command: SyncCommand) {
    await this.transact(
      ["commands", "settings"],
      "readwrite",
      async (transaction) => {
        const commands = transaction.objectStore("commands");
        if (
          (await requestResult(
            commands.get([command.mailboxId, command.commandId])
          )) !== undefined
        ) {
          return;
        }
        const raw = await requestResult(
          transaction.objectStore("settings").get("commandSequence")
        );
        const localSequence =
          (raw === undefined ? 0 : z.number().int().parse(raw)) + 1;
        commands.put({ ...command, localSequence });
        transaction
          .objectStore("settings")
          .put(localSequence, "commandSequence");
      }
    );
  }

  async removeCommand(mailboxId: string, commandId: string) {
    await this.transact(["commands"], "readwrite", async (transaction) => {
      transaction.objectStore("commands").delete([mailboxId, commandId]);
      await Promise.resolve();
    });
  }

  async purge(mailboxId?: string) {
    const generation = crypto.randomUUID();
    await runTransaction(
      this.database,
      stores,
      "readwrite",
      async (transaction) => {
        if (mailboxId === undefined) {
          for (const name of stores) {
            transaction.objectStore(name).clear();
          }
          transaction
            .objectStore("settings")
            .put(generation, "cache-generation");
          return;
        }
        const bodyKeys = z
          .array(z.custom<IDBValidKey>())
          .parse(
            await requestResult(
              transaction
                .objectStore("bodyIndex")
                .index("mailbox")
                .getAllKeys(mailboxId)
            )
          );
        for (const key of bodyKeys) {
          transaction.objectStore("bodies").delete(key);
        }
        for (const name of ["entities", "coverage", "bodyIndex", "commands"]) {
          const keys = z
            .array(z.custom<IDBValidKey>())
            .parse(
              await requestResult(
                transaction
                  .objectStore(name)
                  .index("mailbox")
                  .getAllKeys(mailboxId)
              )
            );
          for (const key of keys) {
            transaction.objectStore(name).delete(key);
          }
        }
        transaction.objectStore("checkpoints").delete(mailboxId);
        transaction.objectStore("settings").put(generation, "cache-generation");
      }
    );
    this.generation = generation;
  }

  async clearCache() {
    const generation = crypto.randomUUID();
    await runTransaction(
      this.database,
      [
        "entities",
        "coverage",
        "checkpoints",
        "bodies",
        "bodyIndex",
        "settings",
      ],
      "readwrite",
      async (transaction) => {
        for (const name of [
          "entities",
          "coverage",
          "checkpoints",
          "bodies",
          "bodyIndex",
        ]) {
          transaction.objectStore(name).clear();
        }
        transaction.objectStore("settings").put(generation, "cache-generation");
        await Promise.resolve();
      }
    );
    this.generation = generation;
  }
}
