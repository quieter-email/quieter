import { db } from "@quieter/database/client";
import {
  mailReminderPreference,
  mailReminderSuggestion,
} from "@quieter/database/schema";
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

export type SuggestionRow = typeof mailReminderSuggestion.$inferSelect;

export const enqueueReminderSuggestion = async (input: {
  userId: string;
  mailboxId: string;
  threadId: string;
  messageId: string;
  timeZone: string;
  automatic: boolean;
}) => {
  await db
    .insert(mailReminderSuggestion)
    .values({
      ...input,
      availableAt: new Date(),
      createdAt: new Date(),
      id: crypto.randomUUID(),
      status: "pending",
    })
    .onConflictDoUpdate({
      set: {
        automatic: sql`${mailReminderSuggestion.automatic} or ${input.automatic}`,
        status: sql`case
          when ${input.automatic} and not ${mailReminderSuggestion.automatic}
            and ${mailReminderSuggestion.status} = 'suggested'
            and ${mailReminderSuggestion.result}->>'automaticEligible' = 'true'
          then 'pending' else ${mailReminderSuggestion.status} end`,
      },
      setWhere: or(
        eq(mailReminderSuggestion.status, "pending"),
        eq(mailReminderSuggestion.status, "suggested")
      ),
      target: [
        mailReminderSuggestion.userId,
        mailReminderSuggestion.mailboxId,
        mailReminderSuggestion.messageId,
      ],
    });
  const [row] = await db
    .select()
    .from(mailReminderSuggestion)
    .where(
      and(
        eq(mailReminderSuggestion.userId, input.userId),
        eq(mailReminderSuggestion.mailboxId, input.mailboxId),
        eq(mailReminderSuggestion.messageId, input.messageId)
      )
    )
    .limit(1);
  if (row === undefined) {
    throw new Error("Reminder suggestion is unavailable.");
  }
  return row;
};

export const enqueueAutomaticReminderSuggestions = async (input: {
  mailboxId: string;
  threadId: string;
  messageId: string;
  receivedAt: Date;
}) => {
  const preferences = await db
    .select()
    .from(mailReminderPreference)
    .where(
      and(
        eq(mailReminderPreference.mailboxId, input.mailboxId),
        eq(mailReminderPreference.automatic, true),
        lte(mailReminderPreference.updatedAt, input.receivedAt)
      )
    );
  for (const preference of preferences) {
    await enqueueReminderSuggestion({
      automatic: true,
      mailboxId: input.mailboxId,
      messageId: input.messageId,
      threadId: input.threadId,
      timeZone: preference.timeZone,
      userId: preference.userId,
    });
  }
};

export const claimReminderSuggestion = async (id?: string) =>
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(mailReminderSuggestion)
      .where(
        and(
          id === undefined ? undefined : eq(mailReminderSuggestion.id, id),
          eq(mailReminderSuggestion.status, "pending"),
          lte(mailReminderSuggestion.availableAt, sql`now()`),
          or(
            isNull(mailReminderSuggestion.leaseUntil),
            lt(mailReminderSuggestion.leaseUntil, sql`now()`)
          )
        )
      )
      .orderBy(mailReminderSuggestion.availableAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (row === undefined) {
      return null;
    }
    const token = crypto.randomUUID();
    const [claimed] = await tx
      .update(mailReminderSuggestion)
      .set({
        attempts: row.attempts + 1,
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 120_000),
      })
      .where(eq(mailReminderSuggestion.id, row.id))
      .returning();
    return claimed === undefined ? null : { row: claimed, token };
  });
