import type * as DatabaseClientModule from "@quieter/database/client";
import {
  afterAll,
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
  });
});
