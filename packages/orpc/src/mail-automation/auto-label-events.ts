import { db } from "@quieter/database/client";
import { gmailAutoLabelEvent } from "@quieter/database/schema";
import { eq } from "drizzle-orm";

export const AUTO_LABEL_BUDGET_RETRY_MS = 1000 * 60 * 60 * 6;

export const deferAutoLabelAutomation = async (eventId: string, message: string) => {
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
