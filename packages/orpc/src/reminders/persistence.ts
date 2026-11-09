import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  mailReminder,
  mailReminderJob,
  mailReminderPreference,
  mailReminderSuggestion,
} from "@quieter/database/schema";
import type { CreateReminder, ReminderSource } from "@quieter/mail/reminders";
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

export type ReminderRow = typeof mailReminder.$inferSelect;
export const enqueueReminderJob = async (
  database: DatabaseExecutor,
  row: ReminderRow,
  kind: "schedule" | "evaluate" | "notify",
  key: string,
  availableAt = new Date()
) => {
  await database
    .insert(mailReminderJob)
    .values({
      attempts: 0,
      availableAt,
      createdAt: new Date(),
      eventId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      kind,
      operationKey: `${row.id}:${key}`,
      reminderId: row.id,
      reminderVersion: row.version,
      scheduleVersion: row.scheduleVersion,
    })
    .onConflictDoNothing();
};

export const claimReminderJob = async (input: {
  kind: "evaluate" | "notify";
  scope?: { userId: string; mailboxId: string };
}) =>
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select({ job: mailReminderJob, reminder: mailReminder })
      .from(mailReminderJob)
      .innerJoin(mailReminder, eq(mailReminder.id, mailReminderJob.reminderId))
      .where(
        and(
          eq(mailReminderJob.kind, input.kind),
          isNull(mailReminderJob.completedAt),
          lte(mailReminderJob.availableAt, sql`now()`),
          or(
            isNull(mailReminderJob.leaseUntil),
            lt(mailReminderJob.leaseUntil, sql`now()`)
          ),
          input.scope
            ? and(
                eq(mailReminder.mailboxId, input.scope.mailboxId),
                eq(mailReminder.userId, input.scope.userId)
              )
            : undefined
        )
      )
      .orderBy(mailReminderJob.availableAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (job === undefined) {
      return null;
    }
    const token = crypto.randomUUID();
    const [claimed] = await tx
      .update(mailReminderJob)
      .set({
        attempts: job.job.attempts + 1,
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 120_000),
      })
      .where(eq(mailReminderJob.id, job.job.id))
      .returning();
    return claimed === undefined
      ? null
      : { job: claimed, reminder: job.reminder, token };
  });

export const finishReminderJob = async (input: {
  id: string;
  token: string;
  retry?: boolean;
}) => {
  await db
    .update(mailReminderJob)
    .set({
      leaseToken: null,
      leaseUntil: null,
      ...(input.retry === true
        ? { availableAt: new Date(Date.now() + 30_000) }
        : { completedAt: new Date() }),
    })
    .where(
      and(
        eq(mailReminderJob.id, input.id),
        eq(mailReminderJob.leaseToken, input.token),
        sql`${mailReminderJob.leaseUntil} > now()`
      )
    );
};

export const createReminderRecord = async (
  input: CreateReminder & {
    userId: string;
    suspended?: boolean;
    source?: ReminderSource;
    suggestionLeaseToken?: string;
  }
) =>
  await db.transaction(async (tx) => {
    if (input.source?.kind === "automatic") {
      const [preference] = await tx
        .select()
        .from(mailReminderPreference)
        .where(
          and(
            eq(mailReminderPreference.userId, input.userId),
            eq(mailReminderPreference.mailboxId, input.mailboxId)
          )
        )
        .for("update");
      if (!preference?.automatic) {
        throw new ORPCError("CONFLICT", {
          message: "Automatic reminders are turned off.",
        });
      }
    }
    if (input.source) {
      const [suggestion] = await tx
        .select()
        .from(mailReminderSuggestion)
        .where(
          and(
            eq(mailReminderSuggestion.id, input.requestId),
            eq(mailReminderSuggestion.userId, input.userId),
            eq(mailReminderSuggestion.mailboxId, input.mailboxId)
          )
        )
        .for("update");
      if (
        suggestion === undefined ||
        suggestion.status === "dismissed" ||
        suggestion.status === "none" ||
        suggestion.leaseToken !== input.suggestionLeaseToken ||
        suggestion.leaseUntil === null ||
        suggestion.leaseUntil.getTime() <= Date.now() ||
        new Date(input.dueAt).getTime() <= Date.now()
      ) {
        throw new ORPCError("CONFLICT", {
          message: "This suggestion is no longer available.",
        });
      }
    }
    const now = new Date();
    const [created] = await tx
      .insert(mailReminder)
      .values({
        ...input,
        createdAt: now,
        dueAt: new Date(input.dueAt),
        evaluationStatus:
          input.target.kind === "thread" && input.target.condition
            ? "pending"
            : "none",
        id: crypto.randomUUID(),
        resolution: input.suspended === true ? "access_lost" : null,
        scheduleVersion: 1,
        status: input.suspended === true ? "suspended" : "active",
        threadId: input.target.kind === "thread" ? input.target.threadId : null,
        updatedAt: now,
        userId: input.userId,
        version: 1,
      })
      .onConflictDoNothing()
      .returning();
    if (created !== undefined) {
      await enqueueReminderJob(tx, created, "schedule", "schedule:1");
      if (created.evaluationStatus === "pending") {
        await enqueueReminderJob(tx, created, "evaluate", "evaluate:1:create");
      }
      return created;
    }
    const [duplicate] = await tx
      .select()
      .from(mailReminder)
      .where(
        and(
          eq(mailReminder.mailboxId, input.mailboxId),
          eq(mailReminder.userId, input.userId),
          eq(mailReminder.requestId, input.requestId)
        )
      )
      .limit(1);
    if (duplicate === undefined) {
      throw new Error("Reminder creation failed.");
    }
    return duplicate;
  });
