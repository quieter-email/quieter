import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { db } from "@quieter/database/client";
import { gmailReplayMetadata, gmailWatchState } from "@quieter/database/schema";
import { gmailThreadChangeFactsSchema } from "@quieter/gmail";
import type { GmailThreadChangeFacts } from "@quieter/gmail";
import { reportError } from "@quieter/observability";
import { and, eq, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "../gmail-mailbox-access";

const MAX_SEALED_BYTES = 512 * 1024;
const PROVIDER_REVISION = /^\d{1,32}$/u;
const table = gmailReplayMetadata;
const expired = sql<boolean>`${table.expiresAt} <= clock_timestamp()`;

type RecordedCoverage = {
  affectedMessageThreads: ReadonlyMap<string, string | undefined>;
  affectedThreadIds: ReadonlySet<string>;
  contentRevision: number;
  headVersion: bigint;
  mailboxId: string;
  signal?: AbortSignal;
  startHistoryId: string;
};

type MetadataReservation =
  | { kind: "hit"; facts: GmailThreadChangeFacts }
  | { kind: "lease"; coverageKey: string; token: string };

const reserveGmailReplayMetadata = async (
  coverage: RecordedCoverage
): Promise<MetadataReservation | null> => {
  const { headVersion, mailboxId, signal, startHistoryId } = coverage;
  const [watch] = await db
    .select({ historyId: gmailWatchState.historyId })
    .from(gmailWatchState)
    .where(eq(gmailWatchState.mailboxId, mailboxId));
  const watchRevision = watch?.historyId;
  // The watch checkpoint can cover different list cursors at the same head.
  const providerRevision =
    watchRevision &&
    PROVIDER_REVISION.test(watchRevision) &&
    BigInt(watchRevision) > BigInt(startHistoryId)
      ? watchRevision
      : startHistoryId;
  const coverageKey = createHash("sha256")
    .update(
      JSON.stringify([
        1,
        mailboxId,
        String(headVersion),
        coverage.contentRevision,
        providerRevision,
        [...coverage.affectedThreadIds].toSorted(),
        [...coverage.affectedMessageThreads].toSorted(([left], [right]) =>
          left.localeCompare(right)
        ),
      ])
    )
    .digest("hex");
  const token = crypto.randomUUID();
  const waitUntil = performance.now() + 8000;

  let delay = 100;
  while (performance.now() < waitUntil) {
    signal?.throwIfAborted();
    const [row] = await db
      .select({
        coverageKey: table.coverageKey,
        expired,
        headVersion: table.headVersion,
        leaseToken: table.leaseToken,
        sealedFacts: sql<
          string | null
        >`case when ${table.coverageKey} = ${coverageKey} and not (${expired}) then ${table.sealedFacts} end`,
      })
      .from(table)
      .where(eq(table.mailboxId, mailboxId));
    if (row?.sealedFacts) {
      const plaintext = decryptSecret(row.sealedFacts);
      if (!plaintext.startsWith(coverageKey)) {
        return null;
      }
      const facts: unknown = JSON.parse(plaintext.slice(coverageKey.length));
      const parsed = gmailThreadChangeFactsSchema.safeParse(facts);
      return parsed.success ? { facts: parsed.data, kind: "hit" } : null;
    }
    if (
      row !== undefined &&
      (row.headVersion > headVersion ||
        (row.headVersion === headVersion &&
          !row.expired &&
          row.leaseToken !== null &&
          row.coverageKey !== coverageKey))
    ) {
      return null;
    }
    if (
      row === undefined ||
      row.headVersion < headVersion ||
      row.expired ||
      row.leaseToken === null
    ) {
      const lease = {
        coverageKey,
        expiresAt: sql`clock_timestamp() + interval '15 seconds'`,
        headVersion,
        leaseToken: token,
        sealedFacts: null,
      };
      const [claimed] = await db
        .insert(table)
        .values({ ...lease, mailboxId })
        .onConflictDoUpdate({
          set: lease,
          setWhere: and(
            lte(table.headVersion, headVersion),
            or(
              lt(table.headVersion, headVersion),
              expired,
              and(isNull(table.leaseToken), ne(table.coverageKey, coverageKey))
            )
          ),
          target: table.mailboxId,
        })
        .returning({ mailboxId: table.mailboxId });
      if (claimed !== undefined) {
        return { coverageKey, kind: "lease", token };
      }
    }
    await sleep(delay + Math.floor(Math.random() * 50), undefined, { signal });
    delay = Math.min(delay * 2, 1000);
  }
  return null;
};

// Called within callGmail after the owner and journal coverage are verified.
export const reuseGmailReplayMetadata = async (
  coverage: RecordedCoverage,
  load: () => Promise<GmailThreadChangeFacts | null>
): Promise<GmailThreadChangeFacts | null> => {
  if (
    !PROVIDER_REVISION.test(coverage.startHistoryId) ||
    (coverage.affectedMessageThreads.size === 0 &&
      coverage.affectedThreadIds.size === 0)
  ) {
    return await load();
  }
  const reservation = await reserveGmailReplayMetadata(coverage).catch(
    (error: unknown) => {
      coverage.signal?.throwIfAborted();
      reportError(error, { boundary: "gmail-replay-metadata-reserve" });
      return null;
    }
  );
  if (reservation?.kind === "hit") {
    coverage.signal?.throwIfAborted();
    return reservation.facts;
  }
  if (reservation === null) {
    coverage.signal?.throwIfAborted();
    return await load();
  }

  const owned = and(
    eq(table.mailboxId, coverage.mailboxId),
    eq(table.leaseToken, reservation.token)
  );
  let saved = false;
  try {
    coverage.signal?.throwIfAborted();
    const facts = await load();
    if (facts === null) {
      return null;
    }
    try {
      const plaintext = reservation.coverageKey + JSON.stringify(facts);
      if (Buffer.byteLength(plaintext) < MAX_SEALED_BYTES) {
        const sealedFacts = encryptSecret(plaintext);
        if (sealedFacts.length <= MAX_SEALED_BYTES) {
          const [stored] = await db
            .update(table)
            .set({
              expiresAt: sql`clock_timestamp() + interval '30 seconds'`,
              leaseToken: null,
              sealedFacts,
            })
            .where(and(owned, sql`not (${expired})`))
            .returning({ mailboxId: table.mailboxId });
          saved = stored !== undefined;
        }
      }
    } catch (error) {
      reportError(error, { boundary: "gmail-replay-metadata-save" });
    }
    return facts;
  } finally {
    if (!saved) {
      await db
        .delete(table)
        .where(owned)
        .catch((error: unknown) => {
          reportError(error, { boundary: "gmail-replay-metadata-release" });
        });
    }
  }
};
