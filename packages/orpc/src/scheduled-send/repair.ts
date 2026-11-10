import { db } from "@quieter/database/client";
import { scheduledMailSend } from "@quieter/database/schema";
import { and, eq, lte } from "drizzle-orm";

import { requestScheduledSendWake } from "./wake";

export const reconcileScheduledSends = async (
  input: { limit?: number } = {}
) => {
  const now = new Date();
  const rows = await db
    .select({
      id: scheduledMailSend.id,
      mailboxId: scheduledMailSend.mailboxId,
      userId: scheduledMailSend.userId,
    })
    .from(scheduledMailSend)
    .where(lte(scheduledMailSend.nextWakeAt, now))
    .orderBy(scheduledMailSend.nextWakeAt)
    .limit(Math.min(input.limit ?? 20, 50));
  let woken = 0;
  for (let offset = 0; offset < rows.length; offset += 4) {
    const results = await Promise.allSettled(
      rows.slice(offset, offset + 4).map(async (scope) => {
        const [claimed] = await db
          .update(scheduledMailSend)
          .set({ nextWakeAt: new Date(now.getTime() + 60_000) })
          .where(
            and(
              eq(scheduledMailSend.id, scope.id),
              lte(scheduledMailSend.nextWakeAt, now)
            )
          )
          .returning({ id: scheduledMailSend.id });
        return claimed !== undefined && (await requestScheduledSendWake(scope));
      })
    );
    for (const result of results) {
      if (result.status === "rejected") {
        throw result.reason;
      }
      if (result.value) {
        woken += 1;
      }
    }
  }
  return { woken };
};
