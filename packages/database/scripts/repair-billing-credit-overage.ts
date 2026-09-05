import type postgres from "postgres";

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
) =>
  await sql.begin(async (transaction) => {
    await transaction`SET LOCAL lock_timeout = '5s'`;
    await transaction`SET LOCAL statement_timeout = '60s'`;
    await transaction`LOCK TABLE "billingCreditUsageEvent" IN SHARE ROW EXCLUSIVE MODE`;
    const affected = await transaction<{ organizationId: string }[]>`
      SELECT DISTINCT "organizationId" FROM "billingCreditUsageEvent"
      WHERE "billableCostMicroCents" > "costMicroCents"
    `;
    if (affected.length === 0) {
      return { repaired: 0 };
    }
    const organizationIds = affected.map((row) => row.organizationId);
    const unsafe = await transaction`
      SELECT "organizationId" FROM "billingCreditUsageEvent"
      WHERE "organizationId" IN ${transaction(organizationIds)}
      GROUP BY "organizationId"
      HAVING sum("costMicroCents") >= 1000000000
        OR min("costMicroCents") < 0
    `;
    if (unsafe.length > 0) {
      throw new Error(
        "Repair requires lifetime usage below the smallest paid allowance."
      );
    }
    const rows = await transaction<CreditRepairRow[]>`
      SELECT id, "organizationId", "costMicroCents"::text,
        "billableCostMicroCents"::text, "createdAt"
      FROM "billingCreditUsageEvent"
      WHERE "organizationId" IN ${transaction(organizationIds)}
        AND "billableCostMicroCents" > 0
      ORDER BY id
    `;
    if (rows.length > 10_000) {
      throw new Error("Repair exceeds the reviewed 10000-row limit.");
    }
    await saveSnapshot(rows);
    const repaired = await transaction`
      UPDATE "billingCreditUsageEvent" SET "billableCostMicroCents" = 0
      WHERE id IN ${transaction(rows.map((row) => row.id))}
      RETURNING id
    `;
    if (repaired.length !== rows.length) {
      throw new Error("Repair count differs from the saved snapshot.");
    }
    return { repaired: repaired.length };
  });
