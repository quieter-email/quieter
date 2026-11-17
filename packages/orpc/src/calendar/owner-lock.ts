import { ORPCError } from "@orpc/server";
import type { DatabaseTransaction } from "@quieter/database/client";
import { user } from "@quieter/database/schema";
import { eq, sql } from "drizzle-orm";

export const lockCalendarBookingOwner = async (input: {
  executor: DatabaseTransaction;
  userId: string;
}): Promise<void> => {
  await input.executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["calendar-booking", input.userId])}, 0))`
  );
  const [owner] = await input.executor
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, input.userId))
    .for("key share");
  if (owner === undefined) {
    throw new ORPCError("UNAUTHORIZED");
  }
};
