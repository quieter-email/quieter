import type { ThreadMessagesResult } from "@quieter/mail/messages";
import { syncBatchSchema, syncSnapshotSchema } from "@quieter/sync";
import type {
  SyncBatch,
  SyncBody,
  SyncChange,
  SyncCheckpoint,
  SyncMessage,
  SyncSnapshot,
} from "@quieter/sync";
import {
  classifySyncBatch,
  mergeSyncChanges,
  reconcileSyncRange,
} from "@quieter/sync/replica";

import type { ReplicaStorage } from "./storage";
import type { SyncApi, SyncClientEvent } from "./types";

type ReplicaOptions = {
  mailboxId: string;
  storage: ReplicaStorage | null;
  api: SyncApi;
  signal: AbortSignal;
  notify: (event: SyncClientEvent) => void;
  bodyCache: Map<string, SyncBody>;
};

export class MailboxReplica {
  readonly mailboxId: string;
  readonly entities = new Map<string, SyncChange>();
  checkpoint: SyncCheckpoint | null = null;
  generation = crypto.randomUUID();
  private readonly options: ReplicaOptions;
  private updates: Promise<unknown> = Promise.resolve();
  private catchup: Promise<void> | null = null;
  private resetting: Promise<void> | null = null;

  constructor(options: ReplicaOptions) {
    this.options = options;
    this.mailboxId = options.mailboxId;
  }

  async load() {
    if (this.options.storage === null) {
      return;
    }
    const { checkpoint, entities } = await this.options.storage.load(
      this.mailboxId
    );
    this.options.signal.throwIfAborted();
    this.checkpoint = checkpoint;
    this.entities.clear();
    for (const entity of entities) {
      this.entities.set(`${entity.kind}:${entity.id}`, entity);
    }
    this.options.notify({
      entities,
      mailboxId: this.mailboxId,
      replace: true,
      type: "entities",
    });
  }

  async acceptPeer(
    checkpoint: SyncCheckpoint,
    entities: SyncChange[],
    replace: boolean,
    reset?: boolean
  ) {
    await this.update(async () => {
      if (
        this.checkpoint !== null &&
        this.checkpoint.epoch === checkpoint.epoch &&
        BigInt(this.checkpoint.sequence) >= BigInt(checkpoint.sequence)
      ) {
        return;
      }
      if (
        !replace &&
        (this.checkpoint?.epoch !== checkpoint.epoch ||
          BigInt(this.checkpoint.sequence) + 1n !== BigInt(checkpoint.sequence))
      ) {
        await this.load();
        return;
      }
      if (replace) {
        this.entities.clear();
      }
      for (const entity of entities) {
        this.entities.set(`${entity.kind}:${entity.id}`, entity);
      }
      this.checkpoint = checkpoint;
      this.options.notify({
        entities,
        mailboxId: this.mailboxId,
        replace,
        reset,
        type: "entities",
      });
      await Promise.resolve();
    });
  }

  private async update<Result>(run: () => Promise<Result>): Promise<Result> {
    const previous = this.updates;
    const pending = (async () => {
      try {
        await previous;
      } catch {
        /* A failed write does not prevent recovery from the last committed cursor. */
      }
      this.options.signal.throwIfAborted();
      return await run();
    })();
    this.updates = pending;
    return await pending;
  }

  async reset() {
    if (this.resetting !== null) {
      await this.resetting;
      return;
    }
    this.generation = crypto.randomUUID();
    const pending = this.resetSnapshot();
    this.resetting = pending;
    try {
      await pending;
    } finally {
      if (this.resetting === pending) {
        this.resetting = null;
      }
    }
  }

  private async resetSnapshot() {
    this.options.notify({ name: "reset", type: "measurement", value: 1 });
    const input = await this.options.api.snapshot(
      this.mailboxId,
      this.options.signal
    );
    if (input === null) {
      throw new Error("The mailbox is still being prepared.");
    }
    const snapshot = syncSnapshotSchema.parse(input);
    if (snapshot.mailboxId !== this.mailboxId) {
      throw new Error("Mailbox snapshot identity mismatch.");
    }
    await this.update(async () => {
      if (
        this.options.storage !== null &&
        !(await this.options.storage.bootstrap(
          snapshot,
          this.checkpoint?.epoch
        ))
      ) {
        await this.load();
        return;
      }
      this.options.signal.throwIfAborted();
      this.entities.clear();
      for (const entity of snapshot.entities) {
        this.entities.set(`${entity.kind}:${entity.id}`, entity);
      }
      this.checkpoint = snapshot.checkpoint;
      this.generation = crypto.randomUUID();
      this.options.notify({
        entities: snapshot.entities,
        mailboxId: this.mailboxId,
        replace: true,
        reset: true,
        type: "entities",
      });
    });
  }

  async apply(input: SyncBatch, generation?: string) {
    const batch = syncBatchSchema.parse(input);
    if (batch.mailboxId !== this.mailboxId) {
      throw new Error("Mailbox batch identity mismatch.");
    }
    return await this.update(async () => {
      if (generation !== undefined && generation !== this.generation) {
        return "duplicate";
      }
      const action = classifySyncBatch(this.checkpoint, batch);
      if (action !== "apply") {
        return action;
      }
      const stored = await this.options.storage?.apply(batch);
      if (stored === "gap" || stored === "reset") {
        return stored;
      }
      this.options.signal.throwIfAborted();
      for (const change of batch.changes) {
        this.entities.set(`${change.kind}:${change.id}`, change);
      }
      this.checkpoint = { epoch: batch.epoch, sequence: batch.sequence };
      this.options.notify({
        entities: batch.changes,
        mailboxId: this.mailboxId,
        replace: false,
        type: "entities",
      });
      return "apply";
    });
  }

  async catchUp() {
    if (this.catchup !== null) {
      await this.catchup;
      return;
    }
    const pending = this.replayToHead();
    this.catchup = pending;
    try {
      await pending;
    } finally {
      if (this.catchup === pending) {
        this.catchup = null;
      }
    }
  }

  private async replayToHead() {
    if (this.checkpoint === null) {
      await this.reset();
    }
    for (let pageIndex = 0; pageIndex < 1000; pageIndex += 1) {
      this.options.signal.throwIfAborted();
      const { checkpoint } = this;
      if (checkpoint === null) {
        throw new Error("Mailbox checkpoint is unavailable.");
      }
      const page = await this.options.api.replay(
        this.mailboxId,
        checkpoint,
        this.options.signal
      );
      if (page.checkpoint.epoch === checkpoint.epoch) {
        this.options.notify({
          name: "replay-lag",
          type: "measurement",
          value: Number(
            BigInt(page.checkpoint.sequence) - BigInt(checkpoint.sequence)
          ),
        });
      }
      if (page.reset) {
        await this.reset();
        continue;
      }
      for (const batch of page.batches) {
        const action = await this.apply(batch);
        if (action === "reset") {
          await this.load();
          break;
        }
        if (action === "gap") {
          throw new Error("Mailbox replay was not contiguous.");
        }
      }
      if (!page.hasMore) {
        return;
      }
    }
    throw new Error("Mailbox replay exceeded its recovery window.");
  }

  private async currentRange(snapshot: SyncSnapshot) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (
        this.checkpoint === null ||
        snapshot.checkpoint.epoch !== this.checkpoint.epoch
      ) {
        await this.reset();
      }
      if (
        this.checkpoint !== null &&
        BigInt(snapshot.checkpoint.sequence) > BigInt(this.checkpoint.sequence)
      ) {
        await this.catchUp();
      }
      const through = this.checkpoint;
      if (through === null || through.epoch !== snapshot.checkpoint.epoch) {
        return false;
      }
      const intervening: SyncBatch[] = [];
      let cursor = snapshot.checkpoint;
      while (BigInt(cursor.sequence) < BigInt(through.sequence)) {
        this.options.signal.throwIfAborted();
        const previous = cursor.sequence;
        const page = await this.options.api.replay(
          this.mailboxId,
          cursor,
          this.options.signal
        );
        if (page.reset || page.batches.length === 0) {
          return false;
        }
        for (const batch of page.batches) {
          if (BigInt(batch.sequence) > BigInt(through.sequence)) {
            break;
          }
          intervening.push(batch);
          cursor = { epoch: batch.epoch, sequence: batch.sequence };
        }
        if (BigInt(cursor.sequence) <= BigInt(previous)) {
          throw new Error("Mailbox range replay did not advance.");
        }
      }
      const reconciled = reconcileSyncRange(snapshot, through, intervening);
      const merged = await this.update(async () => {
        if (
          this.checkpoint?.epoch !== through.epoch ||
          this.checkpoint.sequence !== through.sequence
        ) {
          return false;
        }
        if (
          this.options.storage !== null &&
          !(await this.options.storage.mergeRange(
            snapshot,
            through,
            intervening
          ))
        ) {
          return false;
        }
        this.options.signal.throwIfAborted();
        const covered = new Set(snapshot.coverage.threadIds);
        for (const [key, entity] of this.entities) {
          const threadId =
            entity.data?.kind === "message" || entity.data?.kind === "delivery"
              ? entity.data.value.threadId
              : entity.id;
          if (
            (entity.kind === "message" ||
              entity.kind === "thread" ||
              entity.kind === "delivery") &&
            covered.has(threadId) &&
            !reconciled.has(key)
          ) {
            this.entities.delete(key);
          }
        }
        const updated = mergeSyncChanges(this.entities, [
          ...reconciled.values(),
        ]);
        for (const [key, value] of updated) {
          this.entities.set(key, value);
        }
        this.options.notify({
          entities: [...this.entities.values()],
          mailboxId: this.mailboxId,
          replace: true,
          type: "entities",
        });
        return true;
      });
      if (merged) {
        return true;
      }
      await this.load();
    }
    return false;
  }

  async hydrate(threadIds: string[]) {
    const raw = await this.options.api.hydrate(
      this.mailboxId,
      threadIds,
      this.options.signal
    );
    if (raw === null) {
      throw new Error("Message content is still being prepared.");
    }
    const snapshot = syncSnapshotSchema.parse(raw);
    if (snapshot.mailboxId !== this.mailboxId) {
      throw new Error("Mailbox range identity mismatch.");
    }
    if (!(await this.currentRange(snapshot))) {
      throw new Error("Message content changed while it was loading.");
    }
  }

  async thread(threadId: string, attempt = 0): Promise<ThreadMessagesResult> {
    let thread = this.entities.get(`thread:${threadId}`)?.data;
    if (
      thread?.kind !== "thread" ||
      thread.value.messageIds.some(
        (id) => this.entities.get(`message:${id}`)?.data?.kind !== "message"
      )
    ) {
      await this.hydrate([threadId]);
      thread = this.entities.get(`thread:${threadId}`)?.data;
    }
    if (thread?.kind !== "thread") {
      return { messages: [], threadId };
    }
    const metadata: SyncMessage[] = [];
    for (const id of thread.value.messageIds) {
      const entity = this.entities.get(`message:${id}`)?.data;
      if (entity?.kind === "message") {
        metadata.push(entity.value);
      }
    }
    const messages: ThreadMessagesResult["messages"] = [];
    for (let offset = 0; offset < metadata.length; offset += 2) {
      const loaded = await Promise.all(
        metadata.slice(offset, offset + 2).map(async (message) => {
          const reference = message.body;
          if (reference === null) {
            return message;
          }
          const key = `${this.mailboxId}:${reference.hash}`;
          const started = performance.now();
          let source: "body-memory-ms" | "body-disk-ms" | "body-network-ms" =
            this.options.bodyCache.has(key) ? "body-memory-ms" : "body-disk-ms";
          let body =
            this.options.bodyCache.get(key) ??
            (await this.options.storage?.body(this.mailboxId, reference.hash));
          if (body === undefined || body === null) {
            source = "body-network-ms";
            body = await this.options.api.body(
              this.mailboxId,
              message.id,
              reference.hash,
              this.options.signal
            );
            this.options.signal.throwIfAborted();
            await this.options.storage?.putBody(
              this.mailboxId,
              reference.hash,
              body,
              this.options.signal
            );
          }
          this.options.signal.throwIfAborted();
          this.options.bodyCache.delete(key);
          this.options.bodyCache.set(key, body);
          this.options.notify({
            name: source,
            type: "measurement",
            value: performance.now() - started,
          });
          return { ...message, ...body };
        })
      );
      messages.push(...loaded);
    }
    this.options.signal.throwIfAborted();
    // A body response can race a draft edit or deletion. Rebuild against the current entity versions.
    const current = this.entities.get(`thread:${threadId}`)?.data;
    if (current?.kind !== "thread") {
      return { messages: [], threadId };
    }
    const currentIds = new Set(current.value.messageIds);
    const loadedById = new Map(
      messages.map((message) => [message.id, message])
    );
    const originalById = new Map(
      metadata.map((message) => [message.id, message])
    );
    const changed = current.value.messageIds.some((id) => {
      const entity = this.entities.get(`message:${id}`)?.data;
      return (
        !loadedById.has(id) ||
        (entity?.kind === "message" &&
          entity.value.body?.hash !== originalById.get(id)?.body?.hash)
      );
    });
    if (changed) {
      if (attempt < 2) {
        return await this.thread(threadId, attempt + 1);
      }
      throw new Error("Message content changed while it was loading.");
    }
    const result = {
      messages: messages.filter((message) => currentIds.has(message.id)),
      threadId,
    };
    result.messages = result.messages.map((message) => {
      const entity = this.entities.get(`message:${message.id}`)?.data;
      return entity?.kind === "message"
        ? { ...message, ...entity.value }
        : message;
    });
    this.options.notify({
      mailboxId: this.mailboxId,
      thread: result,
      type: "thread",
    });
    return result;
  }
}
