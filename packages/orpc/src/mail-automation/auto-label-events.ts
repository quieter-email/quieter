import { AI_CREDIT_ADMISSION_BUSY_MESSAGE } from "@quieter/billing/ai-credit-errors";
import { db } from "@quieter/database/client";
import { gmailAutoLabelEvent } from "@quieter/database/schema";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

export const AUTO_LABEL_BUDGET_RETRY_MS = 1000 * 60 * 60 * 6;

export const autoLabelBudgetDeferred = and(
  isNull(gmailAutoLabelEvent.appliedAt),
  isNull(gmailAutoLabelEvent.labelIds),
  isNotNull(gmailAutoLabelEvent.lastError),
  or(
    eq(gmailAutoLabelEvent.attemptCount, 0),
    eq(gmailAutoLabelEvent.lastError, AI_CREDIT_ADMISSION_BUSY_MESSAGE)
  )
);

export const deferAutoLabelAutomation = async (
  eventId: string,
  message: string
) => {
  const now = new Date();
  await db
    .update(gmailAutoLabelEvent)
    .set({
      attemptCount: 0,
      lastError: message,
      nextAttemptAt: new Date(now.getTime() + AUTO_LABEL_BUDGET_RETRY_MS),
      updatedAt: now,
    })
    .where(eq(gmailAutoLabelEvent.id, eventId));
};
