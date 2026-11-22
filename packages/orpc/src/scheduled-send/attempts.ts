import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "@quieter/database/client";
import { scheduledMailSendAbandonment } from "@quieter/database/schema";
import { and, eq, sql } from "drizzle-orm";

type ScheduledSendAttempt = {
  mailboxId: string;
  userId: string;
  sendOperationId: string;
};

export const withScheduledSendAttemptLock = async <Result>(
  scope: ScheduledSendAttempt,
  run: (database: DatabaseTransaction) => Promise<Result>
) =>
  await db.transaction(async (database) => {
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["scheduled-send", scope.mailboxId, scope.userId, scope.sendOperationId])}, 0))`
    );
    return await run(database);
  });

export const assertScheduledSendAttemptActive = async (
  scope: ScheduledSendAttempt,
  database: DatabaseExecutor = db,
  deliveryKind: "scheduled" | "undo" = "scheduled"
) => {
  const [abandoned] = await database
    .select({ sendOperationId: scheduledMailSendAbandonment.sendOperationId })
    .from(scheduledMailSendAbandonment)
    .where(
      and(
        eq(scheduledMailSendAbandonment.mailboxId, scope.mailboxId),
        eq(scheduledMailSendAbandonment.userId, scope.userId),
        eq(scheduledMailSendAbandonment.sendOperationId, scope.sendOperationId)
      )
    )
    .limit(1);
  if (abandoned !== undefined) {
    throw new ORPCError("CONFLICT", {
      data: { scheduleAttemptAbandoned: true },
      message:
        deliveryKind === "undo"
          ? "This send attempt was canceled. Return to your draft before sending again."
          : "This scheduling attempt was canceled. Choose a new send time.",
    });
  }
};
