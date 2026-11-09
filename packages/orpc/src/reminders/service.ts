import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailReminder } from "@quieter/database/schema";
import {
  createReminderSchema,
  changeReminderSchema,
  listRemindersSchema,
  getReminderSchema,
} from "@quieter/mail/reminders";
import type {
  CreateReminder,
  ChangeReminder,
  Reminder,
  ReminderSource,
} from "@quieter/mail/reminders";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { publishMailUpdate } from "../mail-updates";
import { queriesMailOperations } from "../mail/queries";
import { assertAccessibleMailbox } from "../mailbox/service";
import { createReminderRecord, enqueueReminderJob } from "./persistence";
import { enqueueAutomaticReminderSuggestions } from "./suggestion-store";
import { requestReminderWake } from "./wake";

export type ReminderRow = typeof mailReminder.$inferSelect;
export const reminderDto = (row: ReminderRow): Reminder => ({
  createdAt: row.createdAt.toISOString(),
  dueAt: row.dueAt.toISOString(),
  evaluationStatus: row.evaluationStatus,
  evaluationSummary: row.evaluationSummary,
  firedAt: row.firedAt?.toISOString() ?? null,
  id: row.id,
  mailboxId: row.mailboxId,
  resolution: row.resolution,
  scheduleVersion: row.scheduleVersion,
  source: row.source,
  status: row.status,
  target: row.target,
  timeZone: row.timeZone,
  title: row.title,
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});

const validateTarget = async (input: {
  userId: string;
  mailboxId: string;
  target: CreateReminder["target"];
}) => {
  if (input.target.kind !== "thread") {
    return;
  }
  const thread = await queriesMailOperations.getThread({
    context: { userId: input.userId },
    input: { mailboxId: input.mailboxId, threadId: input.target.threadId },
  });
  const anchorId = input.target.anchorMessageId;
  if (
    thread.threadId !== input.target.threadId ||
    !thread.messages.some(
      (message) =>
        message.id === anchorId &&
        !message.draftId &&
        message.labelIds?.includes("DRAFT") !== true
    )
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose a sent or received message in this thread.",
    });
  }
};

export const createReminder = async (
  input: CreateReminder & {
    userId: string;
    source?: ReminderSource;
    suggestionLeaseToken?: string;
  }
): Promise<Reminder> => {
  const value = createReminderSchema.parse({
    dueAt: input.dueAt,
    mailboxId: input.mailboxId,
    requestId: input.requestId,
    target: input.target,
    timeZone: input.timeZone,
    title: input.title,
  });
  await assertAccessibleMailbox(input);
  const [existing] = await db
    .select()
    .from(mailReminder)
    .where(
      and(
        eq(mailReminder.mailboxId, value.mailboxId),
        eq(mailReminder.userId, input.userId),
        eq(mailReminder.requestId, value.requestId)
      )
    )
    .limit(1);
  if (existing !== undefined) {
    if (
      existing.title !== value.title ||
      existing.dueAt.getTime() !== new Date(value.dueAt).getTime() ||
      existing.timeZone !== value.timeZone ||
      existing.target.kind !== value.target.kind ||
      (existing.target.kind === "thread" &&
        value.target.kind === "thread" &&
        (existing.target.threadId !== value.target.threadId ||
          existing.target.anchorMessageId !== value.target.anchorMessageId ||
          existing.target.condition !== value.target.condition))
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "This reminder request was already used. Refresh and try again.",
      });
    }
    return reminderDto(existing);
  }
  await validateTarget(input);
  const row = await createReminderRecord({
    ...value,
    source: input.source,
    suggestionLeaseToken: input.suggestionLeaseToken,
    userId: input.userId,
  });
  await requestReminderWake(input);
  await publishMailUpdate(
    {
      mailboxId: row.mailboxId,
      reminderId: row.id,
      scheduleVersion: row.scheduleVersion,
      type: "reminders.changed",
    },
    { recipientUserIds: [input.userId] }
  );
  return reminderDto(row);
};

export const changeReminder = async (
  input: ChangeReminder & { userId: string }
): Promise<Reminder> => {
  const value = changeReminderSchema.parse({
    command: input.command,
    expectedVersion: input.expectedVersion,
    mailboxId: input.mailboxId,
    reminderId: input.reminderId,
  });
  await assertAccessibleMailbox(input);
  if (value.command.kind === "edit") {
    await validateTarget({ ...input, target: value.command.target });
  }
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mailReminder)
      .where(
        and(
          eq(mailReminder.id, value.reminderId),
          eq(mailReminder.mailboxId, value.mailboxId),
          eq(mailReminder.userId, input.userId)
        )
      )
      .for("update");
    if (current === undefined) {
      throw new ORPCError("NOT_FOUND", { message: "Reminder not found." });
    }
    if (current.version !== value.expectedVersion) {
      throw new ORPCError("CONFLICT", {
        message: "This reminder changed. Refresh it and try again.",
      });
    }
    const { command } = value;
    const next = {
      ...current,
      updatedAt: new Date(),
      version: current.version + 1,
    };
    if (command.kind === "edit") {
      const changedSchedule =
        new Date(command.dueAt).getTime() !== current.dueAt.getTime();
      const changedTarget =
        command.target.kind !== current.target.kind ||
        (command.target.kind === "thread" &&
          current.target.kind === "thread" &&
          (command.target.threadId !== current.target.threadId ||
            command.target.anchorMessageId !== current.target.anchorMessageId ||
            command.target.condition !== current.target.condition));
      Object.assign(next, {
        dueAt: new Date(command.dueAt),
        target: command.target,
        threadId:
          command.target.kind === "thread" ? command.target.threadId : null,
        timeZone: command.timeZone,
        title: command.title,
      });
      if (changedSchedule) {
        Object.assign(next, {
          firedAt: null,
          scheduleVersion: current.scheduleVersion + 1,
        });
      }
      if (changedTarget) {
        Object.assign(next, {
          evaluationStatus:
            command.target.kind === "thread" && command.target.condition
              ? "pending"
              : "none",
          evaluationSummary: null,
        });
      }
    } else if (command.kind === "snooze") {
      Object.assign(next, {
        dueAt: new Date(command.dueAt),
        firedAt: null,
        resolution: null,
        scheduleVersion: current.scheduleVersion + 1,
        status: "active",
        timeZone: command.timeZone,
      });
    } else if (command.kind === "reactivate") {
      Object.assign(next, {
        firedAt: null,
        resolution: null,
        scheduleVersion: current.scheduleVersion + 1,
        status: "active",
      });
    } else {
      Object.assign(next, {
        resolution: "user",
        status: command.kind === "complete" ? "completed" : "cancelled",
      });
    }
    const [updated] = await tx
      .update(mailReminder)
      .set(next)
      .where(eq(mailReminder.id, current.id))
      .returning();
    if (updated === undefined) {
      throw new Error("Reminder change failed.");
    }
    await enqueueReminderJob(
      tx,
      updated,
      "schedule",
      `schedule:edit:${updated.version}`
    );
    if (
      updated.status === "active" &&
      updated.target.kind === "thread" &&
      updated.target.condition
    ) {
      await enqueueReminderJob(
        tx,
        updated,
        "evaluate",
        `evaluate:${updated.version}:edit`
      );
    }
    return updated;
  });
  await requestReminderWake(input);
  await publishMailUpdate(
    {
      mailboxId: row.mailboxId,
      reminderId: row.id,
      scheduleVersion: row.scheduleVersion,
      type: "reminders.changed",
    },
    { recipientUserIds: [input.userId] }
  );
  return reminderDto(row);
};

export const listReminders = async (input: {
  userId: string;
  mailboxId: string;
  view: "active" | "history";
  cursor?: string;
}) => {
  const value = listRemindersSchema.parse({
    cursor: input.cursor,
    mailboxId: input.mailboxId,
    view: input.view,
  });
  await assertAccessibleMailbox(input);
  const rows = await db
    .select()
    .from(mailReminder)
    .where(
      and(
        eq(mailReminder.mailboxId, input.mailboxId),
        eq(mailReminder.userId, input.userId),
        inArray(
          mailReminder.status,
          value.view === "active"
            ? ["active", "suspended"]
            : ["completed", "cancelled"]
        ),
        value.cursor
          ? sql`(${mailReminder.dueAt}, ${mailReminder.id}) > (select "dueAt", "id" from ${mailReminder} where "id" = ${value.cursor} and "userId" = ${input.userId} and "mailboxId" = ${input.mailboxId})`
          : undefined
      )
    )
    .orderBy(asc(mailReminder.dueAt), asc(mailReminder.id))
    .limit(51);
  const items = rows.slice(0, 50).map(reminderDto);
  return {
    items,
    nextCursor: rows.length > 50 ? (items.at(-1)?.id ?? null) : null,
  };
};

export const getReminder = async (input: {
  userId: string;
  mailboxId: string;
  reminderId: string;
}): Promise<Reminder> => {
  getReminderSchema.parse({
    mailboxId: input.mailboxId,
    reminderId: input.reminderId,
  });
  await assertAccessibleMailbox(input);
  const [row] = await db
    .select()
    .from(mailReminder)
    .where(
      and(
        eq(mailReminder.id, input.reminderId),
        eq(mailReminder.mailboxId, input.mailboxId),
        eq(mailReminder.userId, input.userId)
      )
    )
    .limit(1);
  if (row === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Reminder not found." });
  }
  return reminderDto(row);
};

export const observeReminderMail = async (input: {
  mailboxId: string;
  threadId: string;
  messageId: string;
  receivedAt: Date;
}) => {
  await enqueueAutomaticReminderSuggestions(input);
  const rows = await db
    .select()
    .from(mailReminder)
    .where(
      and(
        eq(mailReminder.mailboxId, input.mailboxId),
        eq(mailReminder.threadId, input.threadId),
        eq(mailReminder.status, "active")
      )
    );
  for (const row of rows) {
    if (
      row.target.kind !== "thread" ||
      !row.target.condition ||
      row.target.anchorMessageId === input.messageId ||
      input.receivedAt < row.createdAt
    ) {
      continue;
    }
    await enqueueReminderJob(
      db,
      row,
      "evaluate",
      `evaluate:${row.version}:mail:${input.messageId}`
    );
  }
};
