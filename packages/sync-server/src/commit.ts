import type { DatabaseTransaction } from "@quieter/database/client";
import {
  mailbox,
  mailSyncChange,
  mailSyncOutbox,
  mailSyncStream,
} from "@quieter/database/schema";
import { encodeSyncBatch, syncBatchSchema } from "@quieter/sync";
import type { SyncBatch } from "@quieter/sync";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { initializeSyncBodyReferences } from "./body-references";
import type { SyncBodyStore } from "./body-store";
import { persistSyncEntities } from "./projection-writer";
import type { SyncEntityWrite, SyncTransaction } from "./repository";

export const commitSyncTransaction = async <Result>(
  database: DatabaseTransaction,
  mailboxIds: string[],
  run: (
    database: DatabaseTransaction,
    contexts: ReadonlyMap<string, SyncTransaction>
  ) => Promise<Result>,
  bodies?: SyncBodyStore
) => {
  const ids = [...new Set(mailboxIds)].toSorted();
  const prepared = new Map<
    string,
    {
      context: SyncTransaction;
      epoch: string;
      writes: Map<string, SyncEntityWrite>;
    }
  >();
  if (ids.length > 0) {
    // The lock also fences collection after a mailbox was deleted and its row no longer exists.
    for (const mailboxId of ids) {
      await database.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`quieter-sync:${mailboxId}`}, 0))`
      );
    }
    // Every writer locks mailbox parents before streams, in database order.
    const owners = await database
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(inArray(mailbox.id, ids))
      .orderBy(asc(mailbox.id))
      .for("update");
    if (owners.length !== ids.length) {
      throw new Error("Mailbox not found.");
    }
    await database
      .insert(mailSyncStream)
      .values(
        ids.map((mailboxId) => ({ epoch: crypto.randomUUID(), mailboxId }))
      )
      .onConflictDoNothing();
    const streams = await database
      .select()
      .from(mailSyncStream)
      .where(inArray(mailSyncStream.mailboxId, ids))
      .orderBy(asc(mailSyncStream.mailboxId))
      .for("update");
    for (const stream of streams) {
      if (stream.bodyReferencesInitializedAt === null) {
        await initializeSyncBodyReferences(database, stream.mailboxId);
      }
      const writes = new Map<string, SyncEntityWrite>();
      prepared.set(stream.mailboxId, {
        context: {
          database,
          mailboxId: stream.mailboxId,
          put: (write) => {
            writes.set(`${write.kind}:${write.id}`, write);
          },
          sequence: stream.sequence + 1n,
        },
        epoch: stream.epoch,
        writes,
      });
    }
  }
  const result = await run(
    database,
    new Map([...prepared].map(([id, value]) => [id, value.context]))
  );
  const batches: SyncBatch[] = [];
  for (const { context, epoch, writes } of prepared.values()) {
    const { mailboxId, sequence } = context;
    const changes = await persistSyncEntities(
      database,
      mailboxId,
      sequence,
      [...writes.values()],
      bodies
    );
    if (changes.length === 0) {
      continue;
    }
    const batch = syncBatchSchema.parse({
      changes,
      epoch,
      mailboxId,
      protocol: 1,
      sequence: String(sequence),
    });
    encodeSyncBatch(batch, epoch);
    await database
      .insert(mailSyncChange)
      .values({ changes, epoch, mailboxId, sequence });
    await database.insert(mailSyncOutbox).values({ mailboxId, sequence });
    await database
      .update(mailSyncStream)
      .set({ sequence, updatedAt: new Date() })
      .where(eq(mailSyncStream.mailboxId, mailboxId));
    batches.push(batch);
  }
  return { batches, result };
};
