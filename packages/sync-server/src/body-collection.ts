import type { DatabaseClient } from "@quieter/database/client";
import {
  mailbox,
  mailSyncBody,
  mailSyncStream,
} from "@quieter/database/schema";
import { syncIdSchema } from "@quieter/sync";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { initializeSyncBodyReferences } from "./body-references";
import type { SyncBodyStore } from "./body-store";

const candidateSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  mailboxId: syncIdSchema,
  uploaded: z.date(),
});

export const collectSyncBodies = async (
  database: DatabaseClient,
  store: Pick<SyncBodyStore, "delete">,
  input: z.infer<typeof candidateSchema>[],
  now = new Date()
) => {
  const candidates = z.array(candidateSchema).max(100).parse(input);
  const groups = new Map<string, Set<string>>();
  const cutoff = now.getTime() - 30 * 86_400_000;
  for (const candidate of candidates) {
    if (candidate.uploaded.getTime() > cutoff) {
      continue;
    }
    const group = groups.get(candidate.mailboxId) ?? new Set<string>();
    group.add(candidate.hash);
    groups.set(candidate.mailboxId, group);
  }
  let deleted = 0;
  for (const [mailboxId, hashes] of groups) {
    deleted += await database.transaction(async (transaction) => {
      const [lock] = await transaction.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${`quieter-sync:${mailboxId}`}, 0)) as locked`
      );
      if (!lock?.locked) {
        return 0;
      }
      await transaction
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(eq(mailbox.id, mailboxId))
        .for("update");
      const [stream] = await transaction
        .select()
        .from(mailSyncStream)
        .where(eq(mailSyncStream.mailboxId, mailboxId))
        .for("update");
      if (stream?.bodyReferencesInitializedAt === null) {
        await initializeSyncBodyReferences(transaction, mailboxId);
      }
      const current = await transaction
        .select()
        .from(mailSyncBody)
        .where(
          and(
            eq(mailSyncBody.mailboxId, mailboxId),
            inArray(mailSyncBody.hash, [...hashes])
          )
        );
      const references = new Map(current.map((row) => [row.hash, row]));
      const expired = [...hashes].filter((hash) => {
        const reference = references.get(hash);
        return (
          reference === undefined ||
          (reference.references === 0 &&
            reference.lastReferencedSequence <= (stream?.replayFloor ?? 0n))
        );
      });
      for (let offset = 0; offset < expired.length; offset += 4) {
        await Promise.all(
          expired.slice(offset, offset + 4).map(async (hash) => {
            await store.delete(
              `sync/bodies/${encodeURIComponent(mailboxId)}/${hash}`
            );
          })
        );
      }
      if (expired.length > 0) {
        await transaction
          .delete(mailSyncBody)
          .where(
            and(
              eq(mailSyncBody.mailboxId, mailboxId),
              inArray(mailSyncBody.hash, expired)
            )
          );
      }
      return expired.length;
    });
  }
  return { deleted, scanned: candidates.length };
};
