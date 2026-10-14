import {
  and,
  asc,
  gt,
  gte,
  inArray,
  lt,
  min,
  or,
  sql as drizzleSql,
  sum,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import { billingCreditUsageEvent } from "../src/schema.ts";

type CreditRepairRow = {
  id: string;
  organizationId: string;
  costMicroCents: string;
  billableCostMicroCents: string;
  createdAt: Date;
};

export const repairBillingCreditOverage = async (
  sql: postgres.Sql,
  saveSnapshot: (rows: CreditRepairRow[]) => Promise<void> | void
) => {
  const database = drizzle({ client: sql });
  return await database.transaction(async (transaction) => {
    await transaction.execute(drizzleSql`SET LOCAL lock_timeout = '5s'`);
    await transaction.execute(drizzleSql`SET LOCAL statement_timeout = '60s'`);
    await transaction.execute(
      drizzleSql`LOCK TABLE "billingCreditUsageEvent" IN SHARE ROW EXCLUSIVE MODE`
    );
    const affected = await transaction
      .selectDistinct({
        organizationId: billingCreditUsageEvent.organizationId,
      })
      .from(billingCreditUsageEvent)
      .where(
        gt(
          billingCreditUsageEvent.billableCostMicroCents,
          billingCreditUsageEvent.costMicroCents
        )
      );
    if (affected.length === 0) {
      return { repaired: 0 };
    }
    const organizationIds = affected.map((row) => row.organizationId);
    const unsafe = await transaction
      .select({ organizationId: billingCreditUsageEvent.organizationId })
      .from(billingCreditUsageEvent)
      .where(inArray(billingCreditUsageEvent.organizationId, organizationIds))
      .groupBy(billingCreditUsageEvent.organizationId)
      .having(
        or(
          gte(sum(billingCreditUsageEvent.costMicroCents), 1_000_000_000),
          lt(min(billingCreditUsageEvent.costMicroCents), 0)
        )
      );
    if (unsafe.length > 0) {
      throw new Error(
        "Repair requires lifetime usage below the smallest paid allowance."
      );
    }
    const rows = await transaction
      .select({
        billableCostMicroCents: billingCreditUsageEvent.billableCostMicroCents
          .getSQL()
          .mapWith(String),
        costMicroCents: billingCreditUsageEvent.costMicroCents
          .getSQL()
          .mapWith(String),
        createdAt: billingCreditUsageEvent.createdAt,
        id: billingCreditUsageEvent.id,
        organizationId: billingCreditUsageEvent.organizationId,
      })
      .from(billingCreditUsageEvent)
      .where(
        and(
          inArray(billingCreditUsageEvent.organizationId, organizationIds),
          gt(billingCreditUsageEvent.billableCostMicroCents, 0)
        )
      )
      .orderBy(asc(billingCreditUsageEvent.id));
    if (rows.length > 10_000) {
      throw new Error("Repair exceeds the reviewed 10000-row limit.");
    }
    await saveSnapshot(rows);
    const repaired = await transaction
      .update(billingCreditUsageEvent)
      .set({ billableCostMicroCents: 0 })
      .where(
        inArray(
          billingCreditUsageEvent.id,
          rows.map((row) => row.id)
        )
      )
      .returning({ id: billingCreditUsageEvent.id });
    if (repaired.length !== rows.length) {
      throw new Error("Repair count differs from the saved snapshot.");
    }
    return { repaired: repaired.length };
  });
};
