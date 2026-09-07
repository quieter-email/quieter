import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import { mailboxActionRun } from "@quieter/database/schema";
import { and, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";

export type ActionRunOwner = { id: string; attempts: number };

export const claimMailboxActionRun = async (id: string) => {
  const now = new Date();
  const available = or(
    eq(mailboxActionRun.status, "queued"),
    and(
      eq(mailboxActionRun.status, "running"),
      or(
        isNull(mailboxActionRun.leasedUntil),
        lt(mailboxActionRun.leasedUntil, now)
      )
    )
  );
  await db
    .update(mailboxActionRun)
    .set({
      completedAt: now,
      lastError: "This action reached its retry limit.",
      leasedUntil: null,
      status: "failed",
      updatedAt: now,
    })
    .where(
      and(
        eq(mailboxActionRun.id, id),
        gte(mailboxActionRun.attempts, 6),
        available
      )
    );
  const [run] = await db
    .update(mailboxActionRun)
    .set({
      attempts: sql`${mailboxActionRun.attempts} + 1`,
      leasedUntil: new Date(now.getTime() + 90_000),
      startedAt: now,
      status: "running",
      updatedAt: now,
    })
    .where(
      and(
        eq(mailboxActionRun.id, id),
        lt(mailboxActionRun.attempts, 6),
        available
      )
    )
    .returning();
  return run ?? null;
};

export const withMailboxActionRun = async <T>(
  owner: ActionRunOwner,
  operation: (database: DatabaseExecutor) => Promise<T>
) =>
  await db.transaction(async (tx) => {
    const now = new Date();
    const [run] = await tx
      .update(mailboxActionRun)
      .set({ leasedUntil: new Date(now.getTime() + 90_000), updatedAt: now })
      .where(
        and(
          eq(mailboxActionRun.id, owner.id),
          eq(mailboxActionRun.attempts, owner.attempts),
          eq(mailboxActionRun.status, "running"),
          gt(mailboxActionRun.leasedUntil, now)
        )
      )
      .returning({ id: mailboxActionRun.id });
    if (run === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "This action is no longer owned by this worker.",
      });
    }
    return await operation(tx);
  });
