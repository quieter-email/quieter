import assert from "node:assert/strict";

import { asc, eq } from "drizzle-orm";
import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import { repairBillingCreditOverage } from "./repair-billing-credit-overage.ts";

const creditUsageFixture = pgTable("billingCreditUsageEvent", {
  billableCostMicroCents: bigint("billableCostMicroCents", {
    mode: "bigint",
  }).notNull(),
  costMicroCents: bigint("costMicroCents", { mode: "bigint" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  id: text("id").primaryKey(),
  organizationId: text("organizationId").notNull(),
});

export const testBillingCreditRepair = async (sql: postgres.Sql) => {
  const database = drizzle({ client: sql });
  await sql`CREATE TEMPORARY TABLE "billingCreditUsageEvent" (
    id text PRIMARY KEY, "organizationId" text NOT NULL,
    "costMicroCents" bigint NOT NULL, "billableCostMicroCents" bigint NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
  )`;
  try {
    await database.insert(creditUsageFixture).values([
      {
        billableCostMicroCents: 5_582_384_055_642_819n,
        costMicroCents: 78_000_000n,
        id: "corrupt",
        organizationId: "team-a",
      },
      {
        billableCostMicroCents: 1_000_000_000n,
        costMicroCents: 2_000_000_000n,
        id: "valid",
        organizationId: "team-b",
      },
    ]);
    let saved = false;
    await assert.rejects(
      repairBillingCreditOverage(sql, () => {
        throw new Error("Backup unavailable");
      }),
      /Backup unavailable/u
    );
    const [unchanged] = await database
      .select({
        cost: creditUsageFixture.billableCostMicroCents
          .getSQL()
          .mapWith(String),
      })
      .from(creditUsageFixture)
      .where(eq(creditUsageFixture.id, "corrupt"));
    assert.equal(unchanged?.cost, "5582384055642819");
    const result = await repairBillingCreditOverage(sql, (rows) => {
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.billableCostMicroCents, "5582384055642819");
      saved = true;
    });
    assert.equal(saved, true);
    assert.equal(result.repaired, 1);
    const rows = await database
      .select({
        cost: creditUsageFixture.costMicroCents.getSQL().mapWith(String),
        id: creditUsageFixture.id,
        overage: creditUsageFixture.billableCostMicroCents
          .getSQL()
          .mapWith(String),
      })
      .from(creditUsageFixture)
      .orderBy(asc(creditUsageFixture.id));
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
    await database
      .update(creditUsageFixture)
      .set({ billableCostMicroCents: 3_000_000_000n })
      .where(eq(creditUsageFixture.id, "valid"));
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
