import type * as DatabaseClientModule from "@quieter/database/client";
import { db, withRequestDatabaseClient } from "@quieter/database/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import {
  getBillingCreditUsage,
  recordBillingCreditUsage,
  syncUnreportedBillingCreditUsage,
} from "../src/credits";
import type * as PolarModule from "../src/polar";

const mocks = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  ingest: vi.fn<typeof PolarModule.ingestPolarEvents>(),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: mocks.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});

// This fake implements only the database operations exercised by the test.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(mocks.query);
  return {
    ...actual,
    db: {
      select: database.select.bind(database),
      selectDistinct: database.selectDistinct.bind(database),
      transaction: async <Result>(
        run: (transaction: typeof database) => Promise<Result>
      ) => await run(database),
      update: database.update.bind(database),
    },
  };
});

vi.mock(import("../src/polar"), () => ({ ingestPolarEvents: mocks.ingest }));

const account = {
  creditAmountCents: 2000,
  currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
  currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
  externalCustomerId: "organization:team-a",
  organizationId: "team-a",
  product: "pro" as const,
};

describe.skipIf(mocks.databaseUrl === undefined)(
  "credit periods in PostgreSQL",
  () => {
    const continuingAccount = {
      ...account,
      providerSubscriptionId: "subscription-a",
    };

    beforeAll(async () => {
      const url = new URL(mocks.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Credit accounting tests require loopback quieter_migration_test."
        );
      }
      await withRequestDatabaseClient(async (database) => {
        await database.$client`create temporary table "billingSubscription" (
        "providerSubscriptionId" text not null,
        "organizationId" text not null,
        "plan" text not null,
        "status" text not null,
        "cancelAtPeriodEnd" boolean not null,
        "currentPeriodStart" timestamp not null,
        "currentPeriodEnd" timestamp not null,
        "metadata" jsonb,
        "id" text,
        "scope" text default 'team',
        "userId" text,
        "createdAt" timestamp,
        "updatedAt" timestamp,
        "provider" text,
        "providerCustomerId" text,
        "providerModifiedAt" timestamp,
        "providerProductId" text,
        "periodCreditAmountCents" integer,
        "lastReconciliationFailureAt" timestamp
      )`;
        await database.$client`create temporary table "organization" (
        "id" text primary key,
        "name" text,
        "billingOwnerUserId" text,
        "billingDeletionRequestedAt" timestamp
      )`;
        await database.$client`insert into "organization" ("id", "name") values ('team-a', 'Team A'), ('team-b', 'Team B')`;
        await database.$client`create temporary table "billingCreditUsageEvent" (
        "id" text primary key,
        "organizationId" text not null,
        "scope" text default 'team',
        "category" text not null,
        "createdAt" timestamp not null,
        "costMicroCents" bigint not null,
        "billableCostMicroCents" bigint not null,
        "dedupeKey" text unique,
        "metadata" jsonb,
        "polarEventReportedAt" timestamp,
        "userId" text,
        "chargeableCostMicroCents" bigint,
        "billingPeriodStart" timestamp,
        "billingPeriodEnd" timestamp,
        "externalCustomerId" text,
        "providerSubscriptionId" text,
        "sourceOrganizationId" text,
        "polarEventAttemptedAt" timestamp,
        "polarEventDeferredAt" timestamp,
        "polarEventDeferredReason" text,
        "liabilityWrittenOffAt" timestamp,
        "liabilityWriteOff" jsonb
      )`;
        await database.$client`create temporary table "organizationMailUsageSettings" (
        "organizationId" text primary key,
        "overageEnabled" boolean,
        "monthlyOverageLimitMicroCents" bigint,
        "alertMilestonePercents" jsonb,
        "createdAt" timestamp,
        "updatedAt" timestamp
      )`;
        await database.$client`create temporary table "aiCreditReservation" (
        "id" text primary key,
        "organizationId" text,
        "billingUserId" text,
        "account" jsonb,
        "reservedCostMicroCents" bigint,
        "status" text,
        "createdAt" timestamp
      )`;
        await database.$client`create temporary table "organizationMailSendIdempotency" (
        "id" text primary key,
        "organizationId" text,
        "billingUserId" text,
        "estimatedCostMicroCents" bigint,
        "snapshot" jsonb,
        "response" jsonb,
        "status" text,
        "createdAt" timestamp
      )`;
      });
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      vi.setSystemTime(new Date("2026-10-06T00:00:00.000Z"));
      await withRequestDatabaseClient(async (database) => {
        await database.$client`truncate "billingSubscription", "billingCreditUsageEvent"`;
        await database.$client`insert into "billingSubscription"
        ("providerSubscriptionId", "organizationId", "plan", "status", "cancelAtPeriodEnd", "currentPeriodStart", "currentPeriodEnd", "metadata") values (
        'subscription-a', 'team-a', 'pro', 'active', false,
        '2026-09-01', '2026-10-01', '{"quieterOrganizationId":"team-a"}'
      )`;
        await database.$client`insert into "billingCreditUsageEvent"
        ("id", "organizationId", "category", "createdAt", "costMicroCents", "billableCostMicroCents", "metadata")
        values
          ('before-start', 'team-a', 'ai', '2026-08-31', 999000000, 0, '{"usageKind":"autoLabel"}'),
          ('before-end', 'team-a', 'ai', '2026-09-30', 1900000000, 0, '{"usageKind":"autoLabel"}'),
          ('at-end', 'team-a', 'ai', '2026-10-01', 100000000, 0, '{"usageKind":"autoLabel"}'),
          ('after-end', 'team-a', 'ai', '2026-10-02', 100000000, 100000000, '{"usageKind":"autoLabel"}'),
          ('other-team', 'team-b', 'ai', '2026-10-02', 999000000, 0, '{"usageKind":"autoLabel"}')`;
      });
    });

    afterAll(async () => {
      vi.useRealTimers();
      await withRequestDatabaseClient(async (database) => {
        await database.$client.end();
      });
    });

    test("counts only the snapshot period without including another team or later usage", async () => {
      await withRequestDatabaseClient(async (database) => {
        const usage = await getBillingCreditUsage(continuingAccount, database);
        expect(usage.costMicroCents).toBe(1_900_000_000);
        expect(usage.costMicroCents).toBeLessThan(usage.creditAmountMicroCents);
        expect(usage.billableCostMicroCents).toBe(0);
        expect(usage.breakdown).toContainEqual({
          costMicroCents: 1_900_000_000,
          kind: "autoLabel",
        });
      });
    });

    test.each([
      { cancelAtPeriodEnd: true, status: "active" },
      { cancelAtPeriodEnd: false, status: "trialing" },
      { cancelAtPeriodEnd: false, status: "past_due" },
      { cancelAtPeriodEnd: false, status: "canceled" },
      { cancelAtPeriodEnd: false, status: "expired" },
    ])(
      "keeps the ended accounting window for $status, cancellation $cancelAtPeriodEnd",
      async ({ cancelAtPeriodEnd, status }) => {
        await withRequestDatabaseClient(async (database) => {
          await database.$client`update "billingSubscription"
        set "status" = ${status}, "cancelAtPeriodEnd" = ${cancelAtPeriodEnd}`;
          const usage = await getBillingCreditUsage(
            continuingAccount,
            database
          );
          expect(usage.costMicroCents).toBe(1_900_000_000);
          expect(usage.billableCostMicroCents).toBe(0);
        });
      }
    );

    test("keeps an old send snapshot within its original period after renewal", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`update "billingSubscription"
        set "currentPeriodStart" = '2026-10-02', "currentPeriodEnd" = '2026-11-02'`;
        const oldUsage = await getBillingCreditUsage(
          continuingAccount,
          database
        );
        const renewedUsage = await getBillingCreditUsage(
          {
            ...continuingAccount,
            currentPeriodEnd: new Date("2026-11-02T00:00:00.000Z"),
            currentPeriodStart: new Date("2026-10-02T00:00:00.000Z"),
          },
          database
        );
        expect(oldUsage.costMicroCents).toBe(1_900_000_000);
        expect(renewedUsage.costMicroCents).toBe(100_000_000);
      });
    });

    test("keeps replacement subscriptions outside an old send's allowance", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`insert into "billingSubscription"
          ("providerSubscriptionId", "organizationId", "plan", "status", "cancelAtPeriodEnd", "currentPeriodStart", "currentPeriodEnd", "metadata") values
          ('replacement-a', 'team-a', 'pro', 'canceled', false, '2026-10-02', '2026-10-03', '{"quieterOrganizationId":"team-a"}'),
          ('replacement-b', 'team-a', 'pro', 'active', false, '2026-10-03', '2100-01-01', '{"quieterOrganizationId":"team-a"}'),
          ('other-team', 'team-b', 'pro', 'active', false, '2026-09-15', '2100-01-01', '{"quieterOrganizationId":"team-b"}'),
          ('unowned', 'team-a', 'pro', 'active', false, '2026-09-16', '2100-01-01', '{"quieterOrganizationId":"team-b"}'),
          ('unpaid', 'team-a', 'pro', 'pending', false, '2026-09-17', '2100-01-01', '{"quieterOrganizationId":"team-a"}')`;
        await database.$client`update "billingCreditUsageEvent"
          set "costMicroCents" = 1700000000 where "id" = 'before-end'`;
        await database.$client`insert into "billingCreditUsageEvent"
          ("id", "organizationId", "category", "createdAt", "costMicroCents", "billableCostMicroCents")
          values ('replacement-usage', 'team-a', 'ai', '2026-10-03', 500000000, 0)`;
        const oldUsage = await getBillingCreditUsage(
          continuingAccount,
          database
        );
        expect(oldUsage.costMicroCents).toBe(1_700_000_000);
        const transaction = vi
          .spyOn(db, "transaction")
          .mockImplementation(database.transaction.bind(database));
        const selection = vi
          .spyOn(db, "select")
          .mockImplementation(database.select.bind(database));
        const update = vi
          .spyOn(db, "update")
          .mockImplementation(database.update.bind(database));
        try {
          const result = await recordBillingCreditUsage({
            account: continuingAccount,
            category: "mail",
            costMicroCents: 150_000_000,
            createdAt: new Date("2026-10-01T12:00:00.000Z"),
            dedupeKey: "delayed-old-send",
          });
          expect(result.billableCostMicroCents).toBe(0);
          expect(result.chargeableCostMicroCents).toBe(150_000_000);
          expect(result.polarEventDeferredReason).toBe("closed_period");
        } finally {
          transaction.mockRestore();
          selection.mockRestore();
          update.mockRestore();
        }
      });
    });

    test("requires ownership metadata before extending an identified snapshot", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`update "billingSubscription"
          set "metadata" = '{"quieterOrganizationId":"team-b"}'`;
        const usage = await getBillingCreditUsage(continuingAccount, database);
        expect(usage.costMicroCents).toBe(1_900_000_000);
      });
    });

    test("does not count intervening cycles when the same subscription has renewed multiple times", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`update "billingSubscription"
          set "currentPeriodStart" = '2026-12-01', "currentPeriodEnd" = '2100-01-01'`;
        const usage = await getBillingCreditUsage(continuingAccount, database);
        expect(usage.costMicroCents).toBe(1_900_000_000);
      });
    });

    test("does not let an old stale subscription replay an ended cycle after replacement", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`insert into "billingSubscription"
          ("providerSubscriptionId", "organizationId", "plan", "status", "cancelAtPeriodEnd", "currentPeriodStart", "currentPeriodEnd", "metadata") values
          ('replacement', 'team-a', 'pro', 'active', false, '2026-10-02', '2100-01-01', '{"quieterOrganizationId":"team-a"}')`;
        const selection = vi
          .spyOn(db, "select")
          .mockImplementation(database.select.bind(database));
        const update = vi
          .spyOn(db, "update")
          .mockImplementation(database.update.bind(database));
        try {
          const result = await syncUnreportedBillingCreditUsage();
          expect(result.synced).toBe(1);
          const events = mocks.ingest.mock.calls.flatMap(([batch]) => batch);
          expect(events).toContainEqual(
            expect.objectContaining({ externalId: "credit-usage:after-end" })
          );
          expect(events).not.toContainEqual(
            expect.objectContaining({ externalId: "credit-usage:at-end" })
          );
          expect(events).not.toContainEqual(
            expect.objectContaining({ externalId: "credit-usage:before-end" })
          );
          const deferred = await database.$client`
            select "id", "polarEventDeferredReason" from "billingCreditUsageEvent"
            where "id" in ('at-end', 'before-end')`;
          expect(deferred).toStrictEqual(
            expect.arrayContaining([
              { id: "at-end", polarEventDeferredReason: "closed_period" },
              { id: "before-end", polarEventDeferredReason: "closed_period" },
            ])
          );
        } finally {
          selection.mockRestore();
          update.mockRestore();
        }
      });
    });

    test("keeps legacy snapshots and missing or mismatched subscriptions bounded", async () => {
      await withRequestDatabaseClient(async (database) => {
        for (const billingAccount of [
          account,
          {
            ...continuingAccount,
            providerSubscriptionId: "missing-subscription",
          },
          { ...continuingAccount, organizationId: "team-b" },
        ]) {
          const usage = await getBillingCreditUsage(billingAccount, database);
          expect(usage.costMicroCents).toBe(
            billingAccount.organizationId === "team-a" ? 1_900_000_000 : 0
          );
        }
      });
    });

    test("keeps the snapshot bounded while retrying usage in a corrected open provider period", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`update "billingSubscription"
          set "currentPeriodEnd" = '2100-01-01'`;
        await database.$client`insert into "billingCreditUsageEvent"
          ("id", "organizationId", "category", "createdAt", "costMicroCents", "billableCostMicroCents")
          values ('beyond-period', 'team-a', 'ai', '2100-01-01', 999000000, 0)`;
        const usage = await getBillingCreditUsage(continuingAccount, database);
        expect(usage.costMicroCents).toBe(1_900_000_000);
        const selection = vi
          .spyOn(db, "select")
          .mockImplementation(database.select.bind(database));
        const update = vi
          .spyOn(db, "update")
          .mockImplementation(database.update.bind(database));
        try {
          const result = await syncUnreportedBillingCreditUsage();
          expect(result.synced).toBe(3);
          const events = mocks.ingest.mock.calls.flatMap(([batch]) => batch);
          expect(events).not.toContainEqual(
            expect.objectContaining({
              externalId: "credit-usage:beyond-period",
            })
          );
        } finally {
          selection.mockRestore();
          update.mockRestore();
        }
      });
    });

    test.each([
      { cancelAtPeriodEnd: true, status: "active" },
      { cancelAtPeriodEnd: false, status: "trialing" },
      { cancelAtPeriodEnd: false, status: "past_due" },
    ])(
      "does not replay continued usage for $status, cancellation $cancelAtPeriodEnd",
      async ({ cancelAtPeriodEnd, status }) => {
        await withRequestDatabaseClient(async (database) => {
          await database.$client`update "billingSubscription"
          set "status" = ${status}, "cancelAtPeriodEnd" = ${cancelAtPeriodEnd}`;
          const selection = vi
            .spyOn(db, "select")
            .mockImplementation(database.select.bind(database));
          const update = vi
            .spyOn(db, "update")
            .mockImplementation(database.update.bind(database));
          try {
            const result = await syncUnreportedBillingCreditUsage();
            expect(result.synced).toBe(0);
            expect(mocks.ingest).not.toHaveBeenCalled();
            const deferred = await database.$client`
              select "polarEventDeferredReason" from "billingCreditUsageEvent"
              where "id" = 'before-end'`;
            expect(deferred[0]?.polarEventDeferredReason).toBe("closed_period");
          } finally {
            selection.mockRestore();
            update.mockRestore();
          }
        });
      }
    );

    test("retries eligible usage with original event times", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`update "billingSubscription"
          set "currentPeriodEnd" = '2100-01-01'`;
        const selection = vi
          .spyOn(db, "select")
          .mockImplementation(database.select.bind(database));
        const update = vi
          .spyOn(db, "update")
          .mockImplementation(database.update.bind(database));
        try {
          const result = await syncUnreportedBillingCreditUsage();
          expect(result.synced).toBe(3);
          const events = mocks.ingest.mock.calls.flatMap(([batch]) => batch);
          expect(events).toContainEqual(
            expect.objectContaining({
              externalId: "credit-usage:at-end",
              timestamp: new Date("2026-10-01T00:00:00.000Z"),
            })
          );
          expect(events).toContainEqual(
            expect.objectContaining({
              externalId: "credit-usage:after-end",
              timestamp: new Date("2026-10-02T00:00:00.000Z"),
            })
          );
        } finally {
          selection.mockRestore();
          update.mockRestore();
        }
      });
    });
  }
);

describe("credit accounting with PostgreSQL numeric aggregates", () => {
  const payerAccount = {
    ...account,
    authorizedCostMicroCents: 3_000_000,
    billingOwnerUserId: "payer-a",
    externalCustomerId: "user:payer-a",
    providerSubscriptionId: "subscription-a",
    scope: "account" as const,
  };
  let persistedEvent: Record<string, unknown> | undefined;
  let periodCreditAmountCents = payerAccount.creditAmountCents;

  beforeEach(() => {
    vi.clearAllMocks();
    persistedEvent = undefined;
    periodCreditAmountCents = payerAccount.creditAmountCents;
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
    // oxlint-disable-next-line require-await
    mocks.query.mockImplementation(async (query, params) => {
      if (query.startsWith("insert")) {
        const insertion = /\((?<columns>.*?)\) values \((?<values>.*?)\)/u.exec(
          query
        );
        const columns = insertion?.groups?.columns.split(", ") ?? [];
        const values = insertion?.groups?.values.split(", ") ?? [];
        persistedEvent = Object.fromEntries(
          columns.map((column, index) => {
            const parameter = /\$(?<index>\d+)/u.exec(values[index] ?? "");
            return [
              column.replaceAll('"', ""),
              parameter?.groups === undefined
                ? null
                : params[Number(parameter.groups.index) - 1],
            ];
          })
        );
        for (const key of [
          "billableCostMicroCents",
          "chargeableCostMicroCents",
          "costMicroCents",
        ]) {
          persistedEvent[key] = Number(persistedEvent[key]);
        }
        for (const key of [
          "createdAt",
          "billingPeriodStart",
          "billingPeriodEnd",
        ]) {
          const value = persistedEvent[key];
          if (typeof value === "string") {
            persistedEvent[key] = new Date(value);
          }
        }
        return { rows: [[persistedEvent.id]] };
      }
      if (query.includes("group by")) {
        return {
          rows: query.includes("left join")
            ? [["0", "78000000", "aiChat", "team-a", "Team A"]]
            : [["78000000", "aiChat"]],
        };
      }
      if (query.includes("coalesce(sum(")) {
        if (
          query.includes('from "aiCreditReservation"') ||
          query.includes('from "organizationMailSendIdempotency"')
        ) {
          return { rows: [["0", "0"]] };
        }
        if (query.includes('"sourceOrganizationId" =')) {
          return { rows: [["0"]] };
        }
        return {
          rows: /sum\((?:"\w+"\.)?"costMicroCents"\)/u.test(query)
            ? [["0", "78000000", "78000000"]]
            : [["0", "78000000"]],
        };
      }
      if (query.startsWith("update") && query.includes("returning")) {
        return {
          rows: persistedEvent === undefined ? [] : [[persistedEvent.id]],
        };
      }
      const selection = /^select (?<columns>.*?) from /u.exec(query)?.groups
        ?.columns;
      let row: Record<string, unknown> | undefined;
      if (query.includes('from "billingSubscription"')) {
        row = {
          creditAmountCents: periodCreditAmountCents,
          currentPeriodEnd: payerAccount.currentPeriodEnd,
          currentPeriodStart: payerAccount.currentPeriodStart,
          periodCreditAmountCents,
          providerSubscriptionId: payerAccount.providerSubscriptionId,
          scope: "account",
          status: "active",
          userId: payerAccount.billingOwnerUserId,
        };
      } else if (
        query.includes('from "billingAccountSettings"') ||
        query.includes('from "organizationMailUsageSettings"')
      ) {
        row = { monthlyOverageLimitMicroCents: null, overageEnabled: true };
      } else if (query.includes('from "user"')) {
        row = { id: payerAccount.billingOwnerUserId };
      } else if (query.includes('from "organization"')) {
        row = {
          billingDeletionRequestedAt: null,
          billingOwnerUserId: payerAccount.billingOwnerUserId,
        };
      } else if (
        query.includes('from "billingCreditUsageEvent"') &&
        !query.includes('"dedupeKey" =')
      ) {
        row = persistedEvent;
      }
      return {
        rows:
          row === undefined || selection === undefined
            ? []
            : [
                selection
                  .split(", ")
                  .map(
                    (column) =>
                      row?.[
                        column.replaceAll('"', "").split(".").at(-1) ?? ""
                      ] ?? null
                  ),
              ],
      };
    });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  test("decodes totals and breakdown amounts before doing arithmetic", async () => {
    const usage = await getBillingCreditUsage(payerAccount);

    expect(usage).toMatchObject({
      billableCostMicroCents: 0,
      breakdown: [{ costMicroCents: 78_000_000, kind: "aiChat" }],
      costMicroCents: 78_000_000,
      creditAmountMicroCents: 2_000_000_000,
    });
  });

  test("records zero overage for a small charge within the included balance", async () => {
    const result = await recordBillingCreditUsage({
      account: payerAccount,
      category: "ai",
      costMicroCents: 50_000,
      dedupeKey: "usage-a",
    });

    expect(result.billableCostMicroCents).toBe(0);
    expect(result.chargeableCostMicroCents).toBe(50_000);
    expect(result.polarEventReportedAt).toBeNull();
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  test("charges only the portion exceeding the included balance", async () => {
    periodCreditAmountCents = 80;
    const result = await recordBillingCreditUsage({
      account: { ...payerAccount, creditAmountCents: 80 },
      category: "ai",
      costMicroCents: 3_000_000,
      dedupeKey: "usage-b",
    });

    expect(result.billableCostMicroCents).toBe(1_000_000);
    expect(
      mocks.ingest.mock.calls.flatMap(([events]) => events)
    ).toContainEqual(
      expect.objectContaining({
        metadata: {
          billableMicroCents: 1_000_000,
          creditUsageEventId: result.eventId,
        },
        name: "account-usage",
      })
    );
  });

  test("uses the new provider period and team when loading renewed usage", async () => {
    await getBillingCreditUsage({
      ...account,
      currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
      currentPeriodStart: account.currentPeriodEnd,
    });

    for (const [query, params] of mocks.query.mock.calls) {
      const filterParameters =
        /"organizationId" = \$(?<organization>\d+).*"createdAt" >= \$(?<start>\d+).*"createdAt" < \$(?<end>\d+)/u.exec(
          query
        );
      expect(filterParameters).not.toBeNull();
      expect(
        filterParameters?.slice(1).map((index) => params[Number(index) - 1])
      ).toStrictEqual([
        "team-a",
        "2026-10-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
      ]);
    }
  });

  test("retries persisted events with their original time and identity", async () => {
    const createdAt = new Date("2026-09-01T12:00:00.000Z");
    persistedEvent = {
      billableCostMicroCents: 50_000,
      billingPeriodEnd: payerAccount.currentPeriodEnd,
      billingPeriodStart: payerAccount.currentPeriodStart,
      category: "ai",
      chargeableCostMicroCents: 50_000,
      costMicroCents: 50_000,
      createdAt,
      externalCustomerId: payerAccount.externalCustomerId,
      id: "retry-a",
      metadata: {},
      polarEventReportedAt: null,
      providerSubscriptionId: payerAccount.providerSubscriptionId,
      scope: "account",
      sourceOrganizationId: "team-a",
      userId: payerAccount.billingOwnerUserId,
    };
    await syncUnreportedBillingCreditUsage();
    expect(mocks.ingest.mock.calls).toMatchObject([
      [
        [
          {
            externalId: "account-usage:retry-a",
            metadata: { billableMicroCents: 50_000 },
            timestamp: new Date(createdAt),
          },
        ],
      ],
    ]);
    expect(
      mocks.query.mock.calls.some(
        ([query]) =>
          query.startsWith("update") && query.includes('"polarEventReportedAt"')
      )
    ).toBeTruthy();
  });
});
