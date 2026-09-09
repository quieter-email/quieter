import { isDeepStrictEqual } from "node:util";

import type {
  DatabaseClient,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  mailbox,
  mailSyncChange,
  mailSyncEntity,
  mailSyncOutbox,
  mailSyncStream,
} from "@quieter/database/schema";
import {
  SYNC_REPLAY_BATCHES,
  SYNC_RETENTION_MS,
  encodeSyncBatch,
  syncBatchSchema,
} from "@quieter/sync";
import type {
  SyncBatch,
  SyncChange,
  SyncCheckpoint,
  SyncEntityData,
  SyncEntityKind,
  SyncSnapshot,
} from "@quieter/sync";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

export type SyncEntityWrite = {
  id: string;
  kind: SyncEntityKind;
  data: SyncEntityData | null;
  threadId?: string;
  sortAt?: Date;
  providerGeneration?: string;
};
export type SyncTransaction = {
  database: DatabaseTransaction;
  mailboxId: string;
  sequence: bigint;
  put: (change: SyncEntityWrite) => void;
};
export type SyncDelivery = (batch: SyncBatch) => Promise<void>;
export type SyncReplay = {
  reset: boolean;
  checkpoint: SyncCheckpoint;
  batches: SyncBatch[];
  hasMore: boolean;
};

export class SyncRepository {
  readonly database: DatabaseClient;
  private readonly deliver: SyncDelivery;
  private readonly reportDeliveryFailure: (error: unknown) => void;

  constructor(
    database: DatabaseClient,
    deliver: SyncDelivery,
    reportDeliveryFailure: (error: unknown) => void
  ) {
    this.database = database;
    this.deliver = deliver;
    this.reportDeliveryFailure = reportDeliveryFailure;
  }

  async transaction<Result>(
    mailboxId: string,
    run: (context: SyncTransaction) => Promise<Result>
  ): Promise<Result> {
    const committed = await this.database.transaction(async (database) => {
      // The parent lock establishes the same order for stream creation and existing mailbox writers.
      const [owner] = await database
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId))
        .for("update");
      if (owner === undefined) {
        throw new Error("Mailbox not found.");
      }
      await database
        .insert(mailSyncStream)
        .values({ epoch: crypto.randomUUID(), mailboxId })
        .onConflictDoNothing();
      const [stream] = await database
        .select()
        .from(mailSyncStream)
        .where(eq(mailSyncStream.mailboxId, mailboxId))
        .for("update");
      if (stream === undefined) {
        throw new Error("Mailbox stream is unavailable.");
      }
      const writes = new Map<string, SyncEntityWrite>();
      const sequence = stream.sequence + 1n;
      const result = await run({
        database,
        mailboxId,
        put: (change) => {
          writes.set(`${change.kind}:${change.id}`, change);
        },
        sequence,
      });
      const changes: SyncChange[] = [];
      for (const write of writes.values()) {
        const [existing] = await database
          .select({
            data: mailSyncEntity.data,
            providerGeneration: mailSyncEntity.providerGeneration,
          })
          .from(mailSyncEntity)
          .where(
            and(
              eq(mailSyncEntity.mailboxId, mailboxId),
              eq(mailSyncEntity.kind, write.kind),
              eq(mailSyncEntity.entityId, write.id)
            )
          );
        if (
          (existing !== undefined &&
            isDeepStrictEqual(existing.data, write.data)) ||
          (existing === undefined && write.data === null)
        ) {
          if (
            existing !== undefined &&
            write.providerGeneration !== undefined &&
            existing.providerGeneration !== write.providerGeneration
          ) {
            await database
              .update(mailSyncEntity)
              .set({ providerGeneration: write.providerGeneration })
              .where(
                and(
                  eq(mailSyncEntity.mailboxId, mailboxId),
                  eq(mailSyncEntity.kind, write.kind),
                  eq(mailSyncEntity.entityId, write.id)
                )
              );
          }
          continue;
        }
        const change: SyncChange = {
          data: write.data,
          id: write.id,
          kind: write.kind,
          version: String(sequence),
        };
        changes.push(change);
        await database
          .insert(mailSyncEntity)
          .values({
            data: write.data,
            entityId: write.id,
            kind: write.kind,
            mailboxId,
            providerGeneration: write.providerGeneration,
            sortAt: write.sortAt ?? new Date(),
            threadId: write.threadId ?? null,
            version: sequence,
          })
          .onConflictDoUpdate({
            set: {
              data: write.data,
              providerGeneration: write.providerGeneration,
              sortAt: write.sortAt ?? new Date(),
              threadId: write.threadId ?? null,
              updatedAt: new Date(),
              version: sequence,
            },
            target: [
              mailSyncEntity.mailboxId,
              mailSyncEntity.kind,
              mailSyncEntity.entityId,
            ],
          });
      }
      if (changes.length === 0) {
        return { batch: null, result };
      }
      const batch = syncBatchSchema.parse({
        changes,
        epoch: stream.epoch,
        mailboxId,
        protocol: 1,
        sequence: String(sequence),
      });
      encodeSyncBatch(batch, stream.epoch);
      await database
        .insert(mailSyncChange)
        .values({ changes, epoch: stream.epoch, mailboxId, sequence });
      await database.insert(mailSyncOutbox).values({ mailboxId, sequence });
      await database
        .update(mailSyncStream)
        .set({ sequence, updatedAt: new Date() })
        .where(eq(mailSyncStream.mailboxId, mailboxId));
      return { batch, result };
    });
    if (committed.batch !== null) {
      try {
        await this.deliver(committed.batch);
        await this.database
          .delete(mailSyncOutbox)
          .where(
            and(
              eq(mailSyncOutbox.mailboxId, mailboxId),
              eq(mailSyncOutbox.sequence, BigInt(committed.batch.sequence))
            )
          );
      } catch (error) {
        // The state and outbox are already committed. Delivery failure must not invite a duplicate user operation.
        this.reportDeliveryFailure(error);
      }
    }
    return committed.result;
  }

  async head(mailboxId: string): Promise<SyncCheckpoint | null> {
    const [stream] = await this.database
      .select()
      .from(mailSyncStream)
      .where(eq(mailSyncStream.mailboxId, mailboxId));
    return stream === undefined
      ? null
      : { epoch: stream.epoch, sequence: String(stream.sequence) };
  }

  async snapshot(
    mailboxId: string,
    threadIds?: string[]
  ): Promise<SyncSnapshot | null> {
    return await this.database.transaction(
      async (database) => {
        const [stream] = await database
          .select()
          .from(mailSyncStream)
          .where(eq(mailSyncStream.mailboxId, mailboxId));
        if (stream === undefined || !stream.initialized) {
          return null;
        }
        const threads =
          threadIds === undefined
            ? await database
                .select()
                .from(mailSyncEntity)
                .where(
                  and(
                    eq(mailSyncEntity.mailboxId, mailboxId),
                    eq(mailSyncEntity.kind, "thread"),
                    isNotNull(mailSyncEntity.data)
                  )
                )
                .orderBy(
                  desc(mailSyncEntity.sortAt),
                  desc(mailSyncEntity.entityId)
                )
                .limit(100)
            : [];
        const selectedIds =
          threadIds ?? threads.map((thread) => thread.entityId);
        const records =
          threadIds !== undefined && selectedIds.length === 0
            ? []
            : await database
                .select()
                .from(mailSyncEntity)
                .where(
                  and(
                    eq(mailSyncEntity.mailboxId, mailboxId),
                    or(
                      selectedIds.length > 0
                        ? inArray(mailSyncEntity.threadId, selectedIds)
                        : undefined,
                      threadIds === undefined
                        ? inArray(mailSyncEntity.kind, [
                            "label",
                            "overview",
                            "command",
                            "saved-view",
                          ])
                        : undefined
                    )
                  )
                );
        return {
          checkpoint: {
            epoch: stream.epoch,
            sequence: String(stream.sequence),
          },
          coverage: {
            complete: true,
            kind: threadIds === undefined ? "working-set" : "threads",
            threadIds: selectedIds,
          },
          entities: records.map((record) => ({
            data: record.data,
            id: record.entityId,
            kind: record.kind,
            version: String(record.version),
          })),
          mailboxId,
        };
      },
      { accessMode: "read only", isolationLevel: "repeatable read" }
    );
  }

  async replay(
    mailboxId: string,
    checkpoint: SyncCheckpoint
  ): Promise<SyncReplay> {
    return await this.database.transaction(
      async (database) => {
        const [stream] = await database
          .select()
          .from(mailSyncStream)
          .where(eq(mailSyncStream.mailboxId, mailboxId));
        if (stream === undefined) {
          return { batches: [], checkpoint, hasMore: false, reset: true };
        }
        const head = { epoch: stream.epoch, sequence: String(stream.sequence) };
        const sequence = BigInt(checkpoint.sequence);
        if (
          stream.epoch !== checkpoint.epoch ||
          sequence < stream.replayFloor ||
          sequence > stream.sequence
        ) {
          return { batches: [], checkpoint: head, hasMore: false, reset: true };
        }
        const rows = await database
          .select()
          .from(mailSyncChange)
          .where(
            and(
              eq(mailSyncChange.mailboxId, mailboxId),
              gt(mailSyncChange.sequence, sequence)
            )
          )
          .orderBy(asc(mailSyncChange.sequence))
          .limit(SYNC_REPLAY_BATCHES);
        let expected = sequence + 1n;
        for (const row of rows) {
          if (row.sequence !== expected) {
            throw new Error("Committed mailbox history has a gap.");
          }
          expected += 1n;
        }
        if (rows.length === 0 && sequence < stream.sequence) {
          throw new Error("Committed mailbox history is missing.");
        }
        return {
          batches: rows.map((row) => ({
            changes: row.changes,
            epoch: row.epoch,
            mailboxId,
            protocol: 1,
            sequence: String(row.sequence),
          })),
          checkpoint: head,
          hasMore: expected <= stream.sequence,
          reset: false,
        };
      },
      { accessMode: "read only", isolationLevel: "repeatable read" }
    );
  }

  async recoverOutbox(limit = 50): Promise<number> {
    const due = await this.database.transaction(async (database) => {
      const rows = await database
        .select()
        .from(mailSyncOutbox)
        .where(lte(mailSyncOutbox.nextAttemptAt, new Date()))
        .orderBy(asc(mailSyncOutbox.nextAttemptAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      for (const row of rows) {
        await database
          .update(mailSyncOutbox)
          .set({
            attempts: row.attempts + 1,
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 9))
            ),
          })
          .where(
            and(
              eq(mailSyncOutbox.mailboxId, row.mailboxId),
              eq(mailSyncOutbox.sequence, row.sequence)
            )
          );
      }
      return rows;
    });
    let delivered = 0;
    for (const pending of due) {
      const [record] = await this.database
        .select()
        .from(mailSyncChange)
        .where(
          and(
            eq(mailSyncChange.mailboxId, pending.mailboxId),
            eq(mailSyncChange.sequence, pending.sequence)
          )
        );
      if (record === undefined) {
        throw new Error("Pending delivery lost its committed change.");
      }
      try {
        await this.deliver({
          changes: record.changes,
          epoch: record.epoch,
          mailboxId: record.mailboxId,
          protocol: 1,
          sequence: String(record.sequence),
        });
        await this.database
          .delete(mailSyncOutbox)
          .where(
            and(
              eq(mailSyncOutbox.mailboxId, pending.mailboxId),
              eq(mailSyncOutbox.sequence, pending.sequence)
            )
          );
        delivered += 1;
      } catch (error) {
        this.reportDeliveryFailure(error);
      }
    }
    return delivered;
  }

  async prune(mailboxId: string, now = new Date()): Promise<void> {
    await this.database.transaction(async (database) => {
      const [stream] = await database
        .select()
        .from(mailSyncStream)
        .where(eq(mailSyncStream.mailboxId, mailboxId))
        .for("update");
      if (stream === undefined) {
        return;
      }
      const [pending] = await database
        .select()
        .from(mailSyncOutbox)
        .where(eq(mailSyncOutbox.mailboxId, mailboxId))
        .orderBy(asc(mailSyncOutbox.sequence))
        .limit(1);
      const [last] = await database
        .select({ sequence: mailSyncChange.sequence })
        .from(mailSyncChange)
        .where(
          and(
            eq(mailSyncChange.mailboxId, mailboxId),
            lt(
              mailSyncChange.createdAt,
              new Date(now.getTime() - SYNC_RETENTION_MS)
            ),
            pending === undefined
              ? undefined
              : lt(mailSyncChange.sequence, pending.sequence)
          )
        )
        .orderBy(desc(mailSyncChange.sequence))
        .limit(1);
      if (last === undefined) {
        return;
      }
      await database
        .update(mailSyncStream)
        .set({ replayFloor: last.sequence })
        .where(eq(mailSyncStream.mailboxId, mailboxId));
      await database
        .delete(mailSyncChange)
        .where(
          and(
            eq(mailSyncChange.mailboxId, mailboxId),
            lte(mailSyncChange.sequence, last.sequence)
          )
        );
      await database
        .delete(mailSyncEntity)
        .where(
          and(
            eq(mailSyncEntity.mailboxId, mailboxId),
            lte(mailSyncEntity.version, last.sequence),
            sql`${mailSyncEntity.data} is null`
          )
        );
    });
  }
}
