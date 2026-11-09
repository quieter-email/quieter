import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailReminder, mailReminderJob } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { publishMailUpdate } from "../mail-updates";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  claimReminderJob,
  enqueueReminderJob,
  finishReminderJob,
} from "./persistence";
import { requestReminderWake } from "./wake";

export const assertReminderScopeAccess = async (scope: {
  userId: string;
  mailboxId: string;
}) => {
  try {
    return await assertAccessibleMailbox(scope);
  } catch (error) {
    if (
      error instanceof ORPCError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      await db
        .update(mailReminder)
        .set({
          resolution: "access_lost",
          status: "suspended",
          updatedAt: new Date(),
          version: sql`${mailReminder.version} + 1`,
        })
        .where(
          and(
            eq(mailReminder.userId, scope.userId),
            eq(mailReminder.mailboxId, scope.mailboxId),
            eq(mailReminder.status, "active")
          )
        );
      return null;
    }
    throw error;
  }
};

export const processReminderNotifications = async (
  input: { limit?: number; scope?: { userId: string; mailboxId: string } } = {}
) => {
  let count = 0;
  for (; count < Math.min(input.limit ?? 20, 50); count += 1) {
    const claimed = await claimReminderJob({
      kind: "notify",
      scope: input.scope,
    });
    if (!claimed) {
      break;
    }
    const { job, token } = claimed;
    try {
      const [current] = await db
        .select()
        .from(mailReminder)
        .where(eq(mailReminder.id, job.reminderId))
        .limit(1);
      if (
        current !== undefined &&
        current.status === "active" &&
        current.scheduleVersion === job.scheduleVersion &&
        current.firedAt &&
        (await assertReminderScopeAccess(current))
      ) {
        await publishMailUpdate(
          {
            mailboxId: current.mailboxId,
            reminderId: current.id,
            scheduleVersion: current.scheduleVersion,
            type: "reminders.changed",
          },
          {
            eventId: job.eventId,
            recipientUserIds: [current.userId],
            reliable: true,
          }
        );
      }
      await finishReminderJob({ id: job.id, token });
    } catch (error) {
      reportError(error, { operation: "reminder-notification" });
      await finishReminderJob({ id: job.id, retry: job.attempts < 10, token });
    }
  }
  return count;
};

export const advanceReminderScope = async (scope: {
  userId: string;
  mailboxId: string;
}): Promise<{ nextWakeAt: number | null }> => {
  if (!(await assertReminderScopeAccess(scope))) {
    return { nextWakeAt: null };
  }
  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(mailReminder)
      .where(
        and(
          eq(mailReminder.userId, scope.userId),
          eq(mailReminder.mailboxId, scope.mailboxId),
          eq(mailReminder.status, "active"),
          isNull(mailReminder.firedAt),
          lte(mailReminder.dueAt, sql`now()`)
        )
      )
      .orderBy(mailReminder.dueAt)
      .limit(50)
      .for("update", { skipLocked: true });
    for (const row of due) {
      const [fired] = await tx
        .update(mailReminder)
        .set({ firedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(mailReminder.id, row.id),
            eq(mailReminder.scheduleVersion, row.scheduleVersion),
            isNull(mailReminder.firedAt)
          )
        )
        .returning();
      if (fired === undefined) {
        continue;
      }
      await enqueueReminderJob(
        tx,
        fired,
        "notify",
        `notify:${fired.scheduleVersion}`
      );
      if (fired.target.kind === "thread" && fired.target.condition) {
        await enqueueReminderJob(
          tx,
          fired,
          "evaluate",
          `evaluate:${fired.version}:due:${fired.scheduleVersion}`
        );
      }
    }
    await tx
      .update(mailReminderJob)
      .set({ completedAt: new Date() })
      .where(
        and(
          eq(mailReminderJob.kind, "schedule"),
          isNull(mailReminderJob.completedAt),
          sql`${mailReminderJob.reminderId} in (select id from ${mailReminder} where "userId" = ${scope.userId} and "mailboxId" = ${scope.mailboxId})`
        )
      );
  });
  await processReminderNotifications({ limit: 4, scope });
  const [nextDue] = await db
    .select({
      dueAt: mailReminder.dueAt,
      id: mailReminder.id,
      scheduleVersion: mailReminder.scheduleVersion,
      version: mailReminder.version,
    })
    .from(mailReminder)
    .where(
      and(
        eq(mailReminder.userId, scope.userId),
        eq(mailReminder.mailboxId, scope.mailboxId),
        eq(mailReminder.status, "active"),
        isNull(mailReminder.firedAt)
      )
    )
    .orderBy(mailReminder.dueAt)
    .limit(1);
  if (nextDue !== undefined) {
    await db
      .insert(mailReminderJob)
      .values({
        attempts: 0,
        availableAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        eventId: crypto.randomUUID(),
        id: crypto.randomUUID(),
        kind: "schedule",
        operationKey: `${nextDue.id}:schedule:repair`,
        reminderId: nextDue.id,
        reminderVersion: nextDue.version,
        scheduleVersion: nextDue.scheduleVersion,
      })
      .onConflictDoUpdate({
        set: {
          availableAt: new Date(Date.now() + 60_000),
          completedAt: null,
          reminderVersion: nextDue.version,
          scheduleVersion: nextDue.scheduleVersion,
        },
        target: mailReminderJob.operationKey,
      });
  }
  const [nextNotify] = await db
    .select({
      at: sql<Date>`greatest(${mailReminderJob.availableAt}, coalesce(${mailReminderJob.leaseUntil}, ${mailReminderJob.availableAt}))`,
    })
    .from(mailReminderJob)
    .innerJoin(mailReminder, eq(mailReminder.id, mailReminderJob.reminderId))
    .where(
      and(
        eq(mailReminderJob.kind, "notify"),
        isNull(mailReminderJob.completedAt),
        eq(mailReminder.userId, scope.userId),
        eq(mailReminder.mailboxId, scope.mailboxId)
      )
    )
    .orderBy(
      sql`greatest(${mailReminderJob.availableAt}, coalesce(${mailReminderJob.leaseUntil}, ${mailReminderJob.availableAt}))`
    )
    .limit(1);
  const times = [
    nextDue?.dueAt.getTime(),
    nextNotify === undefined ? undefined : new Date(nextNotify.at).getTime(),
  ].filter((at): at is number => at !== undefined);
  return {
    nextWakeAt: times.length
      ? Math.max(Date.now() + 50, Math.min(...times))
      : null,
  };
};

export const reconcileReminderSchedules = async (
  input: { limit?: number } = {}
) => {
  const scopes = await db
    .select({
      mailboxId: mailReminder.mailboxId,
      userId: mailReminder.userId,
    })
    .from(mailReminderJob)
    .innerJoin(mailReminder, eq(mailReminder.id, mailReminderJob.reminderId))
    .where(
      and(
        eq(mailReminder.status, "active"),
        inArray(mailReminderJob.kind, ["schedule", "notify"]),
        isNull(mailReminderJob.completedAt),
        lte(mailReminderJob.availableAt, sql`now()`)
      )
    )
    .groupBy(mailReminder.userId, mailReminder.mailboxId)
    .orderBy(sql`min(${mailReminderJob.availableAt})`)
    .limit(Math.min(input.limit ?? 100, 500));
  let scheduled = 0;
  for (const scope of scopes) {
    await advanceReminderScope(scope);
    if (await requestReminderWake(scope)) {
      scheduled += 1;
    }
  }
  return { examined: scopes.length, scheduled };
};
