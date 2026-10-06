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
        "metadata" jsonb
      )`;
        await database.$client`create temporary table "organization" ("id" text primary key)`;
        await database.$client`insert into "organization" values ('team-a'), ('team-b')`;
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
        "userId" text
      )`;
      });
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      vi.setSystemTime(new Date("2026-10-06T00:00:00.000Z"));
      await withRequestDatabaseClient(async (database) => {
        await database.$client`truncate "billingSubscription", "billingCreditUsageEvent"`;
        await database.$client`insert into "billingSubscription" values (
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

    test("counts continued usage against one allowance without including another team or earlier period", async () => {
      await withRequestDatabaseClient(async (database) => {
        const usage = await getBillingCreditUsage(continuingAccount, database);
        expect(usage.costMicroCents).toBe(2_100_000_000);
        expect(usage.costMicroCents).toBeGreaterThan(
          usage.creditAmountMicroCents
        );
        expect(usage.billableCostMicroCents).toBe(100_000_000);
        expect(usage.breakdown).toContainEqual({
          costMicroCents: 2_100_000_000,
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
        await database.$client`insert into "billingSubscription" values
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
        } finally {
          transaction.mockRestore();
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
        await database.$client`insert into "billingSubscription" values
          ('replacement', 'team-a', 'pro', 'active', false, '2026-10-02', '2100-01-01', '{"quieterOrganizationId":"team-a"}')`;
        const selection = vi
          .spyOn(db, "selectDistinct")
          .mockImplementation(database.selectDistinct.bind(database));
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

    test("uses a corrected provider end without including usage beyond that period", async () => {
      await withRequestDatabaseClient(async (database) => {
        await database.$client`update "billingSubscription"
          set "currentPeriodEnd" = '2100-01-01'`;
        await database.$client`insert into "billingCreditUsageEvent"
          ("id", "organizationId", "category", "createdAt", "costMicroCents", "billableCostMicroCents")
          values ('beyond-period', 'team-a', 'ai', '2100-01-01', 999000000, 0)`;
        const usage = await getBillingCreditUsage(continuingAccount, database);
        expect(usage.costMicroCents).toBe(2_100_000_000);
        const selection = vi
          .spyOn(db, "selectDistinct")
          .mockImplementation(database.selectDistinct.bind(database));
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
            .spyOn(db, "selectDistinct")
            .mockImplementation(database.selectDistinct.bind(database));
          try {
            const result = await syncUnreportedBillingCreditUsage();
            expect(result.synced).toBe(0);
            expect(mocks.ingest).not.toHaveBeenCalled();
          } finally {
            selection.mockRestore();
          }
        });
      }
    );

    test("retries continued positive usage with original event times", async () => {
      await withRequestDatabaseClient(async (database) => {
        const selection = vi
          .spyOn(db, "selectDistinct")
          .mockImplementation(database.selectDistinct.bind(database));
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
  beforeEach(() => {
    vi.clearAllMocks();
    // oxlint-disable-next-line require-await
    mocks.query.mockImplementation(async (query) => {
      if (query.includes("group by")) {
        return { rows: [["78000000", "aiChat"]] };
      }
      if (query.includes("coalesce(sum(")) {
        return { rows: [["0", "78000000"]] };
      }
      if (query.startsWith("insert")) {
        return { rows: [["event-a"]] };
      }
      return { rows: [] };
    });
  });

  test("decodes totals and breakdown amounts before doing arithmetic", async () => {
    const usage = await getBillingCreditUsage(account);

    expect(usage).toStrictEqual({
      billableCostMicroCents: 0,
      breakdown: [{ costMicroCents: 78_000_000, kind: "aiChat" }],
      costMicroCents: 78_000_000,
      creditAmountMicroCents: 2_000_000_000,
    });
  });

  test("records zero overage for a small charge within the included balance", async () => {
    const result = await recordBillingCreditUsage({
      account,
      category: "ai",
      costMicroCents: 50_000,
      dedupeKey: "usage-a",
    });

    expect(result.billableCostMicroCents).toBe(0);
    expect(mocks.ingest.mock.calls).toMatchObject([
      [[{ metadata: { billableCostCents: 0, credits: 0.05 } }]],
    ]);
  });

  test("charges only the portion exceeding the included balance", async () => {
    const result = await recordBillingCreditUsage({
      account: { ...account, creditAmountCents: 80 },
      category: "ai",
      costMicroCents: 3_000_000,
      dedupeKey: "usage-b",
    });

    expect(result.billableCostMicroCents).toBe(1_000_000);
  });

  test("uses the new provider period and team when loading renewed usage", async () => {
    await getBillingCreditUsage({
      ...account,
      currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
      currentPeriodStart: account.currentPeriodEnd,
    });

    for (const [query, params] of mocks.query.mock.calls) {
      expect(query).toContain('"organizationId" = $1');
      expect(query).toContain('"createdAt" >= $2');
      expect(query).toContain('"createdAt" < $3');
      expect(params.slice(0, 3)).toStrictEqual([
        "team-a",
        "2026-10-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
      ]);
    }
  });

  test("retries persisted events with their original time and identity", async () => {
    const createdAt = new Date("2026-09-01T12:00:00.000Z");
    mocks.query.mockResolvedValueOnce({
      rows: [["0", "ai", "50000", createdAt, "retry-a", {}, "team-a"]],
    });
    await syncUnreportedBillingCreditUsage();
    expect(mocks.ingest.mock.calls).toMatchObject([
      [
        [
          {
            externalId: "credit-usage:retry-a",
            timestamp: new Date(createdAt),
          },
        ],
      ],
    ]);
    const query = mocks.query.mock.calls[0]?.[0];
    expect(query).toContain("select distinct");
    expect(query).toContain('"currentPeriodEnd" >');
  });
});
