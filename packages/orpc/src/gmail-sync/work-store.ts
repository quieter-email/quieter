import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import { gmailMessageWork, gmailWatchState } from "@quieter/database/schema";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

export type GmailWorkPriority = typeof gmailMessageWork.$inferSelect.source;
export type GmailWorkClaim =
  | { status: "claimed"; work: typeof gmailMessageWork.$inferSelect }
  | { status: "empty" };
// The queue's maximum invocation lifetime is 15 minutes.
const WORK_LEASE_MS = 16 * 60_000;
const unfinished = or(
  isNull(gmailMessageWork.completedAt),
  isNotNull(gmailMessageWork.lastError),
  and(
    sql`${gmailMessageWork.triggerActions} is true`,
    isNull(gmailMessageWork.actionsCompletedAt)
  )
);

export const enqueueGmailMessageWork = async (input: {
  mailboxId: string;
  messageIds: string[];
  source: GmailWorkPriority;
  triggerActions?: boolean;
  notificationReceivedAt?: Date;
  resumeCritical?: boolean;
}) => {
  const now = new Date();
  const messages = [...new Set(input.messageIds)];
  if (messages.length === 0) {
    return;
  }
  await db
    .insert(gmailMessageWork)
    .values(
      messages.map((gmailMessageId, position) => ({
        createdAt: now,
        dueAt: now,
        gmailMessageId,
        id: randomUUID(),
        mailboxId: input.mailboxId,
        notificationReceivedAt: input.notificationReceivedAt,
        position,
        priorityAt: now,
        source: input.source,
        triggerActions: input.triggerActions ?? false,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      set: {
        ...(input.resumeCritical === true
          ? {
              completedAt: null,
              dueAt: sql`least(${gmailMessageWork.dueAt}, excluded."dueAt")`,
            }
          : {}),
        notificationReceivedAt: sql`least(${gmailMessageWork.notificationReceivedAt}, excluded."notificationReceivedAt")`,
        position: sql`case when excluded.source = 'fresh' then excluded.position else ${gmailMessageWork.position} end`,
        priorityAt: sql`case when excluded.source = 'fresh' then excluded."priorityAt" else ${gmailMessageWork.priorityAt} end`,
        source: sql`case when excluded.source = 'fresh' then 'fresh' else ${gmailMessageWork.source} end`,
        triggerActions: sql`${gmailMessageWork.triggerActions} or excluded."triggerActions"`,
        updatedAt: now,
      },
      target: [gmailMessageWork.mailboxId, gmailMessageWork.gmailMessageId],
    });
};

export const getGmailMessageWorkWake = async (input: {
  priority: GmailWorkPriority;
  mailboxId: string;
}) => {
  const [next] = await db
    .select({
      dueAt: gmailMessageWork.dueAt,
      leaseUntil: gmailMessageWork.leaseUntil,
      providerRetryAt: gmailWatchState.providerRetryAt,
    })
    .from(gmailMessageWork)
    .leftJoin(
      gmailWatchState,
      eq(gmailWatchState.mailboxId, gmailMessageWork.mailboxId)
    )
    .where(
      and(
        eq(gmailMessageWork.source, input.priority),
        eq(gmailMessageWork.mailboxId, input.mailboxId),
        unfinished
      )
    )
    .orderBy(
      asc(
        sql`greatest(${gmailMessageWork.dueAt}, ${gmailMessageWork.leaseUntil}, ${gmailWatchState.providerRetryAt})`
      )
    )
    .limit(1);
  const nextWakeAt =
    next === undefined
      ? null
      : new Date(
          Math.max(
            next.dueAt.getTime(),
            next.leaseUntil?.getTime() ?? 0,
            next.providerRetryAt?.getTime() ?? 0
          )
        );
  return {
    moreReady: nextWakeAt !== null && nextWakeAt.getTime() <= Date.now(),
    nextWakeAt,
  };
};

export const hasPendingFreshGmailWork = async (
  mailboxId: string,
  client: Pick<typeof db, "select"> = db
) => {
  const now = new Date();
  const [pending] = await client
    .select({ id: gmailMessageWork.id })
    .from(gmailMessageWork)
    .where(
      and(
        eq(gmailMessageWork.mailboxId, mailboxId),
        eq(gmailMessageWork.source, "fresh"),
        unfinished,
        lte(gmailMessageWork.dueAt, now)
      )
    )
    .limit(1);
  return pending !== undefined;
};

export const claimGmailMessageWork = async (input: {
  priority: GmailWorkPriority;
  mailboxId: string;
}): Promise<GmailWorkClaim> =>
  await db.transaction(
    async (tx): Promise<GmailWorkClaim> => {
      const now = new Date();
      const [candidate] = await tx
        .select({ work: gmailMessageWork })
        .from(gmailMessageWork)
        .leftJoin(
          gmailWatchState,
          eq(gmailWatchState.mailboxId, gmailMessageWork.mailboxId)
        )
        .where(
          and(
            eq(gmailMessageWork.source, input.priority),
            eq(gmailMessageWork.mailboxId, input.mailboxId),
            unfinished,
            or(
              isNull(gmailWatchState.providerRetryAt),
              lte(gmailWatchState.providerRetryAt, now)
            ),
            lte(gmailMessageWork.dueAt, now),
            or(
              isNull(gmailMessageWork.leaseUntil),
              lte(gmailMessageWork.leaseUntil, now)
            )
          )
        )
        .orderBy(
          desc(gmailMessageWork.priorityAt),
          asc(gmailMessageWork.position)
        )
        .limit(1)
        .for("update", { of: gmailMessageWork, skipLocked: true });
      if (candidate === undefined) {
        return { status: "empty" };
      }
      if (
        input.priority === "catchup" &&
        (await hasPendingFreshGmailWork(candidate.work.mailboxId, tx))
      ) {
        return { status: "empty" };
      }
      const [watch] = await tx
        .select()
        .from(gmailWatchState)
        .where(eq(gmailWatchState.mailboxId, candidate.work.mailboxId))
        .limit(1);
      if (
        watch?.providerRetryAt !== null &&
        watch?.providerRetryAt !== undefined &&
        watch.providerRetryAt > now
      ) {
        return { status: "empty" };
      }
      if (
        watch?.processingLeaseExpiresAt &&
        watch.processingLeaseExpiresAt > now &&
        (watch.processingLeaseId === null ||
          watch.processingWorkLeaseId !== watch.processingLeaseId)
      ) {
        return { status: "empty" };
      }
      const leaseToken = randomUUID();
      const [claimed] = await tx
        .update(gmailMessageWork)
        .set({
          attempts: sql`${gmailMessageWork.attempts} + 1`,
          leaseToken,
          leaseUntil: new Date(now.getTime() + WORK_LEASE_MS),
          updatedAt: now,
        })
        .where(eq(gmailMessageWork.id, candidate.work.id))
        .returning();
      return claimed === undefined
        ? { status: "empty" }
        : { status: "claimed", work: claimed };
    },
    { isolationLevel: "read committed" }
  );

export const finishGmailMessageWork = async (input: {
  id: string;
  leaseToken: string;
  criticalComplete: boolean;
  actionsComplete: boolean;
  retryAt: Date | null;
  lastError: string | null;
}) => {
  const now = new Date();
  await db
    .update(gmailMessageWork)
    .set({
      ...(input.criticalComplete ? { completedAt: now } : {}),
      ...(input.actionsComplete ? { actionsCompletedAt: now } : {}),
      dueAt: input.retryAt ?? now,
      lastError: input.lastError,
      leaseToken: null,
      leaseUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailMessageWork.id, input.id),
        eq(gmailMessageWork.leaseToken, input.leaseToken),
        gt(gmailMessageWork.leaseUntil, now)
      )
    );
};

export const pruneCompletedGmailMessageWork = async (limit = 10_000) => {
  const expired = db
    .select({ id: gmailMessageWork.id })
    .from(gmailMessageWork)
    .where(
      and(
        isNotNull(gmailMessageWork.completedAt),
        isNull(gmailMessageWork.lastError),
        or(
          sql`${gmailMessageWork.triggerActions} is false`,
          isNotNull(gmailMessageWork.actionsCompletedAt)
        ),
        lte(gmailMessageWork.updatedAt, sql`now() - interval '30 days'`)
      )
    )
    .orderBy(asc(gmailMessageWork.updatedAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  await db
    .delete(gmailMessageWork)
    .where(inArray(gmailMessageWork.id, expired));
};

export const getGmailMailboxProviderRetryAt = async (mailboxId: string) => {
  const [state] = await db
    .select({ providerRetryAt: gmailWatchState.providerRetryAt })
    .from(gmailWatchState)
    .where(eq(gmailWatchState.mailboxId, mailboxId))
    .limit(1);
  return state?.providerRetryAt ?? null;
};

export const deferGmailMailboxProvider = async (
  mailboxId: string,
  retryAt: Date
) => {
  const now = new Date();
  const [state] = await db
    .insert(gmailWatchState)
    .values({
      createdAt: now,
      mailboxId,
      providerRetryAt: retryAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        providerRetryAt: sql`greatest(${gmailWatchState.providerRetryAt}, excluded."providerRetryAt")`,
        updatedAt: now,
      },
      target: gmailWatchState.mailboxId,
    })
    .returning({ providerRetryAt: gmailWatchState.providerRetryAt });
  return state?.providerRetryAt ?? retryAt;
};
