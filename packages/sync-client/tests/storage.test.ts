import "fake-indexeddb/auto";
import { createHash } from "node:crypto";

import type { SyncBatch, SyncSnapshot } from "@quieter/sync";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ReplicaStorage } from "../src/storage";

const openStores: ReplicaStorage[] = [];
const open = async () => {
  const store = await ReplicaStorage.open(crypto.randomUUID());
  openStores.push(store);
  return store;
};
const snapshot = (mailboxId: string): SyncSnapshot => ({
  checkpoint: { epoch: "fee7cf22-9de0-4c47-bc2b-ad2420eab6cc", sequence: "0" },
  coverage: { complete: true, kind: "working-set", threadIds: [] },
  entities: [],
  mailboxId,
});
const labelBatch = (mailboxId: string): SyncBatch => ({
  changes: [
    {
      data: { kind: "label", value: { id: "work", name: "Work" } },
      id: "work",
      kind: "label",
      version: "1",
    },
  ],
  epoch: snapshot(mailboxId).checkpoint.epoch,
  mailboxId,
  protocol: 1,
  sequence: "1",
});

describe("browser mail persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const store of openStores.splice(0)) {
      store.close();
    }
  });

  it("commits the cursor with its entities and rejects duplicates and gaps", async () => {
    const store = await open();
    await store.bootstrap(snapshot("first"));
    await expect(store.apply(labelBatch("first"))).resolves.toBe("apply");
    await expect(store.apply(labelBatch("first"))).resolves.toBe("duplicate");
    await expect(
      store.apply({ ...labelBatch("first"), changes: [], sequence: "3" })
    ).resolves.toBe("gap");
    await expect(store.checkpoint("first")).resolves.toMatchObject({
      sequence: "1",
    });
    await expect(store.entities("first")).resolves.toHaveLength(1);
  });

  it("does not acknowledge a cursor when a quota failure aborts its entity writes", async () => {
    const store = await open();
    await store.bootstrap(snapshot("first"));
    // oxlint-disable-next-line typescript/unbound-method -- The original method is invoked with the real object store below.
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function put(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      if (this.name === "checkpoints") {
        throw new DOMException("Quota exhausted", "QuotaExceededError");
      }
      return original.call(this, value, key);
    });
    await expect(store.apply(labelBatch("first"))).rejects.toThrow(
      "Quota exhausted"
    );
    await expect(store.checkpoint("first")).resolves.toMatchObject({
      sequence: "0",
    });
    await expect(store.entities("first")).resolves.toStrictEqual([]);
  });

  it("fences stale range hydration and preserves deletions made after the snapshot", async () => {
    const store = await open();
    await store.bootstrap(snapshot("first"));
    const added = labelBatch("first");
    await store.apply(added);
    const range: SyncSnapshot = {
      ...snapshot("first"),
      checkpoint: { epoch: added.epoch, sequence: "1" },
      entities: added.changes,
    };
    const deleted: SyncBatch = {
      ...added,
      changes: [{ data: null, id: "work", kind: "label", version: "2" }],
      sequence: "2",
    };
    await store.apply(deleted);
    await expect(
      store.mergeRange(range, range.checkpoint, [])
    ).resolves.toBeFalsy();
    await expect(
      store.mergeRange(range, { epoch: added.epoch, sequence: "2" }, [deleted])
    ).resolves.toBeTruthy();
    const entities = await store.entities("first");
    expect(entities[0]).toMatchObject({ data: null, version: "2" });
  });

  it("isolates mailbox entities and evicts unpinned bodies without losing a resume cursor", async () => {
    const store = await open();
    await store.bootstrap(snapshot("first"));
    await store.bootstrap(snapshot("second"));
    await store.apply(labelBatch("first"));
    await store.apply(labelBatch("second"));
    const body = { bodyText: "Cached message body" };
    const hash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    await store.putBody("first", hash, body);
    await store.putBody("second", hash, body);
    await store.enforceBudget(1, new Set([`second:${hash}`]));
    await expect(store.body("first", hash)).resolves.toBeNull();
    await expect(store.body("second", hash)).resolves.toStrictEqual(body);
    await store.purge("first");
    await expect(store.entities("first")).resolves.toStrictEqual([]);
    await expect(store.entities("second")).resolves.toHaveLength(1);
    await expect(store.checkpoint("second")).resolves.toMatchObject({
      sequence: "1",
    });
  });
});
