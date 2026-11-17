import { db } from "@quieter/database/client";
import { mailSnooze } from "@quieter/database/schema";
import { and, eq, lte } from "drizzle-orm";

import { requestMailSnoozeWake } from "./wake";

export const reconcileMailSnoozes = async (input: { limit?: number } = {}) => {
  const now = new Date();
  const rows = await db
    .select({
      id: mailSnooze.id,
      mailboxId: mailSnooze.mailboxId,
      version: mailSnooze.version,
    })
    .from(mailSnooze)
    .where(lte(mailSnooze.nextWakeAt, now))
    .orderBy(mailSnooze.nextWakeAt)
    .limit(Math.min(input.limit ?? 20, 50));
  let woken = 0;
  for (let offset = 0; offset < rows.length; offset += 4) {
    const results = await Promise.allSettled(
      rows.slice(offset, offset + 4).map(async (row) => {
        const [claimed] = await db
          .update(mailSnooze)
          .set({ nextWakeAt: new Date(now.getTime() + 60_000) })
          .where(
            and(
              eq(mailSnooze.id, row.id),
              eq(mailSnooze.version, row.version),
              lte(mailSnooze.nextWakeAt, now)
            )
          )
          .returning({ id: mailSnooze.id });
        return (
          claimed !== undefined &&
          (await requestMailSnoozeWake({
            id: row.id,
            mailboxId: row.mailboxId,
          }))
        );
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
