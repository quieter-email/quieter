import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  getBillingCreditUsage,
  recordBillingCreditUsage,
} from "../src/credits";

const mocks = vi.hoisted(() => ({
  ingest: vi.fn<() => Promise<void>>(),
  query:
    vi.fn<
      (query: string, params: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
}));

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const actual = await importOriginal();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(mocks.query);
  return {
    ...actual,
    db: Object.assign(actual.db, {
      select: database.select.bind(database),
      transaction: async <Result>(
        run: (transaction: typeof database) => Promise<Result>
      ) => await run(database),
      update: database.update.bind(database),
    }),
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
});
