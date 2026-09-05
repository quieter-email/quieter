import assert from "node:assert/strict";

import type postgres from "postgres";

import { repairBillingCreditOverage } from "./repair-billing-credit-overage.ts";

export const testBillingCreditRepair = async (sql: postgres.Sql) => {
  await sql`CREATE TEMPORARY TABLE "billingCreditUsageEvent" (
    id text PRIMARY KEY, "organizationId" text NOT NULL,
    "costMicroCents" bigint NOT NULL, "billableCostMicroCents" bigint NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
  )`;
  try {
    await sql`INSERT INTO "billingCreditUsageEvent"
      (id, "organizationId", "costMicroCents", "billableCostMicroCents")
      VALUES ('corrupt', 'team-a', 78000000, 5582384055642819),
        ('valid', 'team-b', 2000000000, 1000000000)`;
    let saved = false;
    await assert.rejects(
      repairBillingCreditOverage(sql, () => {
        throw new Error("Backup unavailable");
      }),
      /Backup unavailable/u
    );
    const [unchanged] = await sql`SELECT "billableCostMicroCents"::text AS cost
      FROM "billingCreditUsageEvent" WHERE id = 'corrupt'`;
    assert.equal(unchanged?.cost, "5582384055642819");
    const result = await repairBillingCreditOverage(sql, (rows) => {
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.billableCostMicroCents, "5582384055642819");
      saved = true;
    });
    assert.equal(saved, true);
    assert.equal(result.repaired, 1);
    const rows = await sql`SELECT id, "costMicroCents"::text AS cost,
      "billableCostMicroCents"::text AS overage FROM "billingCreditUsageEvent" ORDER BY id`;
    assert.deepEqual(
      [...rows],
      [
        { cost: "78000000", id: "corrupt", overage: "0" },
        { cost: "2000000000", id: "valid", overage: "1000000000" },
      ]
    );
    const repeated = await repairBillingCreditOverage(sql, () => {
      assert.fail("An idempotent repair must not produce another snapshot");
    });
    assert.equal(repeated.repaired, 0);
    await sql`UPDATE "billingCreditUsageEvent" SET "billableCostMicroCents" = 3000000000 WHERE id = 'valid'`;
    await assert.rejects(
      repairBillingCreditOverage(sql, () => {
        assert.fail("Unsafe repairs must fail before saving a snapshot");
      }),
      /lifetime usage/u
    );
  } finally {
    await sql`DROP TABLE pg_temp."billingCreditUsageEvent"`;
  }
};
