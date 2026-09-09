import type {
  DatabaseClient,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  mailSyncCommand,
  mailSyncChange,
  mailSyncEntity,
  mailSyncOutbox,
  mailSyncStream,
} from "@quieter/database/schema";
import { SYNC_REPLAY_BATCHES, SYNC_RETENTION_MS } from "@quieter/sync";
import type {
  SyncBatch,
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

import { commitSyncTransaction } from "./commit";

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
    return await this.transactionMany(
      [mailboxId],
      async (_database, contexts) => {
        const context = contexts.get(mailboxId);
        if (context === undefined) {
          throw new Error("Mailbox stream is unavailable.");
        }
        return await run(context);
      }
    );
  }

  async transactionMany<Result>(
    mailboxIds: string[],
    run: (
      database: DatabaseTransaction,
      contexts: ReadonlyMap<string, SyncTransaction>
    ) => Promise<Result>
  ): Promise<Result> {
    const committed = await this.database.transaction(
      async (database) => await commitSyncTransaction(database, mailboxIds, run)
    );
    await Promise.all(
      committed.batches.map(async (batch) => {
        try {
          await this.deliver(batch);
          await this.database
            .delete(mailSyncOutbox)
            .where(
              and(
                eq(mailSyncOutbox.mailboxId, batch.mailboxId),
                eq(mailSyncOutbox.sequence, BigInt(batch.sequence))
              )
            );
        } catch (error) {
          // State and outbox are committed; delivery failure must not repeat the domain operation.
          this.reportDeliveryFailure(error);
        }
      })
    );
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
      await database
        .delete(mailSyncCommand)
        .where(
          and(
            eq(mailSyncCommand.mailboxId, mailboxId),
            inArray(mailSyncCommand.status, ["applied", "failed"]),
            lt(
              mailSyncCommand.updatedAt,
              new Date(now.getTime() - 90 * 86_400_000)
            )
          )
        );
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
        await database
          .update(mailSyncStream)
          .set({ updatedAt: now })
          .where(eq(mailSyncStream.mailboxId, mailboxId));
        return;
      }
      await database
        .update(mailSyncStream)
        .set({ replayFloor: last.sequence, updatedAt: now })
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
            or(
              sql`${mailSyncEntity.data} is null`,
              and(
                eq(mailSyncEntity.kind, "command"),
                sql`${mailSyncEntity.data}->'value'->>'status' in ('applied', 'failed')`
              )
            )
          )
        );
    });
  }
}
