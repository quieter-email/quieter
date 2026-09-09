import type { DatabaseTransaction } from "@quieter/database/client";
import {
  mailSyncBody,
  mailSyncEntity,
  mailSyncChange,
  mailSyncStream,
} from "@quieter/database/schema";
import type { SyncChange, SyncEntityData } from "@quieter/sync";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { SyncBodyStore } from "./body-store";

export const initializeSyncBodyReferences = async (
  database: DatabaseTransaction,
  mailboxId: string
) => {
  await database.execute(sql`
    WITH body_references AS (
      SELECT "mailboxId", data->'value'->'body'->>'hash' AS hash, version AS sequence, 1 AS reference_count
      FROM ${mailSyncEntity}
      WHERE "mailboxId" = ${mailboxId} AND kind = 'message' AND data->'value'->'body'->>'hash' IS NOT NULL
      UNION ALL
      SELECT "mailboxId", entry->'data'->'value'->'body'->>'hash' AS hash, sequence, 0 AS reference_count
      FROM ${mailSyncChange}, jsonb_array_elements(changes) AS entry
      WHERE "mailboxId" = ${mailboxId} AND entry->>'kind' = 'message' AND entry->'data'->'value'->'body'->>'hash' IS NOT NULL
    )
    INSERT INTO ${mailSyncBody} ("mailboxId", hash, "lastReferencedSequence", "references")
    SELECT "mailboxId", hash, max(sequence), sum(reference_count)::integer
    FROM body_references
    GROUP BY "mailboxId", hash
    ON CONFLICT ("mailboxId", hash) DO UPDATE SET "lastReferencedSequence" = excluded."lastReferencedSequence", "references" = excluded."references"
  `);
  await database
    .update(mailSyncStream)
    .set({ bodyReferencesInitializedAt: new Date() })
    .where(eq(mailSyncStream.mailboxId, mailboxId));
};

export const persistSyncBodyReferences = async (
  database: DatabaseTransaction,
  mailboxId: string,
  sequence: bigint,
  changes: SyncChange[],
  previous: ReadonlyMap<string, { data: SyncEntityData | null }>,
  bodies?: SyncBodyStore
) => {
  const deltas = new Map<string, number>();
  const added = new Set<string>();
  for (const change of changes) {
    if (change.kind !== "message") {
      continue;
    }
    const old = previous.get(`message:${change.id}`)?.data;
    const before = old?.kind === "message" ? old.value.body?.hash : undefined;
    const after =
      change.data?.kind === "message"
        ? change.data.value.body?.hash
        : undefined;
    if (before === after) {
      continue;
    }
    if (before !== undefined) {
      deltas.set(before, (deltas.get(before) ?? 0) - 1);
    }
    if (after !== undefined) {
      deltas.set(after, (deltas.get(after) ?? 0) + 1);
      added.add(after);
    }
  }
  if (deltas.size === 0) {
    return;
  }
  if (bodies !== undefined) {
    const hashes = [...added];
    for (let offset = 0; offset < hashes.length; offset += 4) {
      await Promise.all(
        hashes.slice(offset, offset + 4).map(async (hash) => {
          if (
            !(await bodies.has(
              `sync/bodies/${encodeURIComponent(mailboxId)}/${hash}`
            ))
          ) {
            // Collection may win after preparation; retry ingestion before committing a missing reference.
            throw new Error(
              "Prepared message content expired before it was committed."
            );
          }
        })
      );
    }
  }
  const current = await database
    .select()
    .from(mailSyncBody)
    .where(
      and(
        eq(mailSyncBody.mailboxId, mailboxId),
        inArray(mailSyncBody.hash, [...deltas.keys()])
      )
    );
  const existing = new Map(current.map((row) => [row.hash, row.references]));
  const rows = [...deltas].map(([hash, delta]) => ({
    hash,
    lastReferencedSequence: sequence,
    mailboxId,
    references: (existing.get(hash) ?? 0) + delta,
  }));
  for (let offset = 0; offset < rows.length; offset += 500) {
    await database
      .insert(mailSyncBody)
      .values(rows.slice(offset, offset + 500))
      .onConflictDoUpdate({
        set: {
          lastReferencedSequence: sql`excluded."lastReferencedSequence"`,
          references: sql`excluded."references"`,
        },
        target: [mailSyncBody.mailboxId, mailSyncBody.hash],
      });
  }
};
