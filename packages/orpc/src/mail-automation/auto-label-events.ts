import { randomUUID } from "node:crypto";

import { db } from "@quieter/database/client";
import { gmailAutoLabelEvent } from "@quieter/database/schema";
import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";

import { reportAutoLabelUsage } from "./usage";

export const AUTO_LABEL_BUDGET_RETRY_MS = 1000 * 60 * 60 * 6;
export const AUTO_LABEL_PROCESSING_MESSAGE = "Automatic labeling in progress.";

export const claimAutoLabelEvent = async (
  event: typeof gmailAutoLabelEvent.$inferSelect,
  explicitRetry: boolean
) => {
  const now = new Date();
  const [claimed] = await db
    .update(gmailAutoLabelEvent)
    .set({
      lastError: AUTO_LABEL_PROCESSING_MESSAGE,
      nextAttemptAt: new Date(now.getTime() + 1000 * 60 * 10),
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailAutoLabelEvent.id, event.id),
        eq(gmailAutoLabelEvent.updatedAt, event.updatedAt),
        isNull(gmailAutoLabelEvent.appliedAt),
        or(
          isNull(gmailAutoLabelEvent.nextAttemptAt),
          lte(gmailAutoLabelEvent.nextAttemptAt, now),
          explicitRetry
            ? ne(gmailAutoLabelEvent.lastError, AUTO_LABEL_PROCESSING_MESSAGE)
            : undefined
        )
      )
    )
    .returning();
  return claimed;
};

export const reopenEmptyAutoLabelEvent = async (
  event: typeof gmailAutoLabelEvent.$inferSelect,
  userId: string
) => {
  if (event.labelIds?.length !== 0) {
    return event;
  }
  await reportAutoLabelUsage({ ...event, userId });
  const [current] = await db
    .select()
    .from(gmailAutoLabelEvent)
    .where(eq(gmailAutoLabelEvent.id, event.id));
  if (current === undefined) {
    throw new Error("Automatic labeling changed. Please try again.");
  }
  if (current.costUsd !== null && !current.usageReportedAt) {
    throw new Error("Previous automatic labeling usage could not be recorded.");
  }
  // A new usage identity prevents billing deduplication from discarding this run.
  const [reopened] = await db
    .update(gmailAutoLabelEvent)
    .set({
      appliedAt: null,
      attemptCount: 0,
      cacheWriteTokens: null,
      cachedTokens: null,
      completionTokens: null,
      costUsd: null,
      id: randomUUID(),
      labelIds: null,
      lastError: null,
      model: null,
      nextAttemptAt: null,
      promptTokens: null,
      updatedAt: new Date(),
      usageReportedAt: null,
    })
    .where(
      and(
        eq(gmailAutoLabelEvent.id, event.id),
        sql`${gmailAutoLabelEvent.labelIds} = '[]'::jsonb`
      )
    )
    .returning();
  if (reopened === undefined) {
    throw new Error("Automatic labeling changed. Please try again.");
  }
  return reopened;
};

export const deferAutoLabelAutomation = async (
  eventId: string,
  message: string
) => {
  const now = new Date();
  await db
    .update(gmailAutoLabelEvent)
    .set({
      lastError: message,
      nextAttemptAt: new Date(now.getTime() + AUTO_LABEL_BUDGET_RETRY_MS),
      updatedAt: now,
    })
    .where(eq(gmailAutoLabelEvent.id, eventId));
};
