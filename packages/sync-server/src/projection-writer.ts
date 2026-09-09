import { isDeepStrictEqual } from "node:util";

import type { DatabaseTransaction } from "@quieter/database/client";
import { mailSyncEntity } from "@quieter/database/schema";
import type { SyncChange } from "@quieter/sync";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { SyncEntityWrite } from "./repository";

export const persistSyncEntities = async (
  database: DatabaseTransaction,
  mailboxId: string,
  sequence: bigint,
  writes: SyncEntityWrite[]
) => {
  const existing = new Map<string, typeof mailSyncEntity.$inferSelect>();
  for (let offset = 0; offset < writes.length; offset += 1000) {
    const rows = await database
      .select()
      .from(mailSyncEntity)
      .where(
        and(
          eq(mailSyncEntity.mailboxId, mailboxId),
          inArray(
            mailSyncEntity.entityId,
            writes.slice(offset, offset + 1000).map((write) => write.id)
          )
        )
      );
    for (const row of rows) {
      existing.set(`${row.kind}:${row.entityId}`, row);
    }
  }
  const changes: SyncChange[] = [];
  const rows: (typeof mailSyncEntity.$inferInsert)[] = [];
  const now = new Date();
  for (const write of writes) {
    const previous = existing.get(`${write.kind}:${write.id}`);
    if (
      (previous !== undefined &&
        isDeepStrictEqual(previous.data, write.data)) ||
      (previous === undefined && write.data === null)
    ) {
      if (
        previous !== undefined &&
        write.providerGeneration !== undefined &&
        previous.providerGeneration !== write.providerGeneration
      ) {
        rows.push({
          ...previous,
          providerGeneration: write.providerGeneration,
        });
      }
      continue;
    }
    changes.push({
      data: write.data,
      id: write.id,
      kind: write.kind,
      version: String(sequence),
    });
    rows.push({
      data: write.data,
      entityId: write.id,
      kind: write.kind,
      mailboxId,
      providerGeneration:
        write.providerGeneration ?? previous?.providerGeneration ?? null,
      sortAt: write.sortAt ?? now,
      threadId: write.threadId ?? null,
      updatedAt: now,
      version: sequence,
    });
  }
  for (let offset = 0; offset < rows.length; offset += 500) {
    await database
      .insert(mailSyncEntity)
      .values(rows.slice(offset, offset + 500))
      .onConflictDoUpdate({
        set: {
          data: sql`excluded."data"`,
          providerGeneration: sql`excluded."providerGeneration"`,
          sortAt: sql`excluded."sortAt"`,
          threadId: sql`excluded."threadId"`,
          updatedAt: sql`excluded."updatedAt"`,
          version: sql`excluded."version"`,
        },
        target: [
          mailSyncEntity.mailboxId,
          mailSyncEntity.kind,
          mailSyncEntity.entityId,
        ],
      });
  }
  return changes;
};
