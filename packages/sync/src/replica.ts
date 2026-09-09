import type {
  SyncBatch,
  SyncChange,
  SyncCheckpoint,
  SyncSnapshot,
} from "./protocol";

export const classifySyncBatch = (
  checkpoint: SyncCheckpoint | null,
  batch: SyncBatch
) => {
  if (checkpoint === null || checkpoint.epoch !== batch.epoch) {
    return "reset";
  }
  const current = BigInt(checkpoint.sequence);
  const next = BigInt(batch.sequence);
  if (next <= current) {
    return "duplicate";
  }
  return next === current + 1n ? "apply" : "gap";
};

export const mergeSyncChanges = (
  current: ReadonlyMap<string, SyncChange>,
  changes: readonly SyncChange[]
) => {
  const merged = new Map(current);
  for (const change of changes) {
    const key = `${change.kind}:${change.id}`;
    const existing = merged.get(key);
    if (
      existing === undefined ||
      BigInt(existing.version) < BigInt(change.version)
    ) {
      merged.set(key, change);
    }
  }
  return merged;
};

export const reconcileSyncRange = (
  snapshot: SyncSnapshot,
  through: SyncCheckpoint,
  intervening: readonly SyncBatch[]
) => {
  let { checkpoint } = snapshot;
  let entities = mergeSyncChanges(new Map(), snapshot.entities);
  if (
    checkpoint.epoch !== through.epoch ||
    BigInt(checkpoint.sequence) > BigInt(through.sequence)
  ) {
    throw new Error("The range belongs to a different replica checkpoint.");
  }
  for (const batch of intervening) {
    if (batch.mailboxId !== snapshot.mailboxId) {
      throw new Error("The range contains another mailbox.");
    }
    const action = classifySyncBatch(checkpoint, batch);
    if (action === "duplicate") {
      continue;
    }
    if (
      action !== "apply" ||
      BigInt(batch.sequence) > BigInt(through.sequence)
    ) {
      throw new Error("The range requires missing changes.");
    }
    entities = mergeSyncChanges(entities, batch.changes);
    checkpoint = { epoch: batch.epoch, sequence: batch.sequence };
  }
  if (checkpoint.sequence !== through.sequence) {
    throw new Error("The range is not current yet.");
  }
  return entities;
};
