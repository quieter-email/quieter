import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import {
  gmailMessageWork,
  gmailWatchState,
  mailbox,
  organization,
} from "@quieter/database/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

export type GmailWorkPriority = typeof gmailMessageWork.$inferSelect.source;
export type GmailWorkClaim =
  | { status: "claimed"; work: typeof gmailMessageWork.$inferSelect }
  | { status: "empty" }
  | { status: "capacity_busy"; activeLeases: number; retryAt: Date };
// The queue's maximum invocation lifetime is 15 minutes.
const WORK_LEASE_MS = 16 * 60_000;
const unfinished = or(
  isNull(gmailMessageWork.completedAt),
  isNotNull(gmailMessageWork.lastError),
  and(
    eq(gmailMessageWork.triggerActions, true),
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
  mailboxId?: string;
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
        input.mailboxId === undefined
          ? undefined
          : eq(gmailMessageWork.mailboxId, input.mailboxId),
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

export const claimGmailMessageWork = async (input: {
  priority: GmailWorkPriority;
  mailboxId?: string;
}): Promise<GmailWorkClaim> =>
  await db.transaction(
    async (tx): Promise<GmailWorkClaim> => {
      let now = new Date();
      if (input.priority === "fresh") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('gmail-message-work:fresh-admission', 0))`
        );
        // This statement starts after the lock, unlike transaction-scoped now().
        const [capacity] = await tx
          .select({
            activeLeases: count(),
            now: sql<Date>`statement_timestamp() at time zone 'UTC'`.mapWith(
              gmailMessageWork.dueAt
            ),
          })
          .from(gmailMessageWork)
          .where(
            and(
              eq(gmailMessageWork.source, "fresh"),
              gt(
                gmailMessageWork.leaseUntil,
                sql`statement_timestamp() at time zone 'UTC'`
              )
            )
          );
        if (capacity === undefined) {
          throw new Error("Gmail work admission did not return its capacity.");
        }
        ({ now } = capacity);
        if (capacity.activeLeases >= 4) {
          return {
            activeLeases: capacity.activeLeases,
            retryAt: new Date(now.getTime() + 5000),
            status: "capacity_busy",
          };
        }
      }
      const [candidate] = await tx
        .select({
          account: mailbox,
          billingOwnerUserId: organization.billingOwnerUserId,
          work: gmailMessageWork,
        })
        .from(gmailMessageWork)
        .innerJoin(mailbox, eq(mailbox.id, gmailMessageWork.mailboxId))
        .leftJoin(
          gmailWatchState,
          eq(gmailWatchState.mailboxId, gmailMessageWork.mailboxId)
        )
        .leftJoin(organization, eq(organization.id, mailbox.organizationId))
        .where(
          and(
            eq(gmailMessageWork.source, input.priority),
            input.mailboxId === undefined
              ? undefined
              : eq(gmailMessageWork.mailboxId, input.mailboxId),
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
      const billingOwnerUserId =
        candidate.billingOwnerUserId ?? candidate.account.ownerUserId;
      const accountPredicate =
        billingOwnerUserId === null
          ? eq(mailbox.organizationId, candidate.account.organizationId)
          : sql`coalesce((select owner."billingOwnerUserId" from organization owner where owner.id = ${mailbox.organizationId}), ${mailbox.ownerUserId}) = ${billingOwnerUserId}`;
      if (input.priority === "catchup") {
        const [fresh] = await tx
          .select({ id: gmailMessageWork.id })
          .from(gmailMessageWork)
          .innerJoin(mailbox, eq(mailbox.id, gmailMessageWork.mailboxId))
          .leftJoin(
            gmailWatchState,
            eq(gmailWatchState.mailboxId, gmailMessageWork.mailboxId)
          )
          .where(
            and(
              accountPredicate,
              eq(gmailMessageWork.source, "fresh"),
              unfinished,
              or(
                isNull(gmailWatchState.providerRetryAt),
                lte(gmailWatchState.providerRetryAt, now)
              ),
              lte(gmailMessageWork.dueAt, now)
            )
          )
          .limit(1);
        if (fresh !== undefined) {
          return { status: "empty" };
        }
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

export const hasPendingFreshGmailWorkForAccount = async (mailboxId: string) => {
  const [account] = await db
    .select({
      account: mailbox,
      billingOwnerUserId: organization.billingOwnerUserId,
    })
    .from(mailbox)
    .leftJoin(organization, eq(organization.id, mailbox.organizationId))
    .where(eq(mailbox.id, mailboxId))
    .limit(1);
  if (account === undefined) {
    return false;
  }
  const [pending] = await db
    .select({ id: gmailMessageWork.id })
    .from(gmailMessageWork)
    .innerJoin(mailbox, eq(mailbox.id, gmailMessageWork.mailboxId))
    .leftJoin(
      gmailWatchState,
      eq(gmailWatchState.mailboxId, gmailMessageWork.mailboxId)
    )
    .where(
      and(
        (account.billingOwnerUserId ?? account.account.ownerUserId) === null
          ? eq(mailbox.organizationId, account.account.organizationId)
          : sql`coalesce((select owner."billingOwnerUserId" from organization owner where owner.id = ${mailbox.organizationId}), ${mailbox.ownerUserId}) = ${account.billingOwnerUserId ?? account.account.ownerUserId}`,
        eq(gmailMessageWork.source, "fresh"),
        unfinished,
        or(
          isNull(gmailWatchState.providerRetryAt),
          lte(gmailWatchState.providerRetryAt, new Date())
        ),
        or(
          lte(gmailMessageWork.dueAt, new Date()),
          gt(gmailMessageWork.leaseUntil, new Date())
        )
      )
    )
    .limit(1);
  return pending !== undefined;
};

export const listGmailMessageWorkWakeJobs = async (limit = 500) => {
  const rows = await db
    .select({
      mailboxId: gmailMessageWork.mailboxId,
      nextWakeAt:
        sql<Date>`min(greatest(${gmailMessageWork.dueAt}, ${gmailMessageWork.leaseUntil}, ${gmailWatchState.providerRetryAt}))`.mapWith(
          gmailMessageWork.dueAt
        ),
      priority: gmailMessageWork.source,
    })
    .from(gmailMessageWork)
    .leftJoin(
      gmailWatchState,
      eq(gmailWatchState.mailboxId, gmailMessageWork.mailboxId)
    )
    .where(unfinished)
    .groupBy(gmailMessageWork.mailboxId, gmailMessageWork.source)
    .orderBy(
      asc(
        sql`min(greatest(${gmailMessageWork.dueAt}, ${gmailMessageWork.leaseUntil}, ${gmailWatchState.providerRetryAt}))`
      )
    )
    .limit(limit);
  return rows;
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
