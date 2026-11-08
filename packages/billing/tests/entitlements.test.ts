import { DatabaseSync } from "node:sqlite";

import {
  PolarClientError,
  PolarNetworkError,
  PolarRateLimitError,
  PolarServerError,
} from "@polar-sh/sdk";
import type { models } from "@polar-sh/sdk/2026-04";
import type * as DatabaseClientModule from "@quieter/database/client";
import { organization } from "@quieter/database/schema";
import type * as ServerEnvModule from "@quieter/env/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import {
  getOrganizationSubscription,
  getOrganizationSubscriptionRecord,
  isActiveBillingSubscription,
  isLocalDevelopmentBillingEntitlementEnabled,
  shouldReconcileBillingSubscription,
} from "../src/entitlements";
import type * as PolarModule from "../src/polar";
import type * as SubscriptionSyncModule from "../src/subscription-sync";

type PolarClient = Awaited<ReturnType<typeof PolarModule.getPolarClient>>;
type Subscription = models.Subscription;

const polarSubscriptionSchema = z.custom<Subscription>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
);

const polarSubscription = (id: string) =>
  polarSubscriptionSchema.parse({
    customer_id: "customer-a",
    id,
    metadata: {
      quieterProduct: "pro",
      quieterScope: "account",
      quieterUserId: "user-a",
    },
    product_id: "pro-product",
  });

const polarState = vi.hoisted(() => ({
  getPolarClient: null as typeof PolarModule.getPolarClient | null,
}));

const billingMocks = vi.hoisted(() => {
  const limit = vi.fn<() => Promise<unknown[]>>();
  const loadRows = vi.fn<() => Promise<unknown[]>>();
  const where =
    vi.fn<() => { limit: typeof limit; orderBy: typeof loadRows }>();
  const from = vi.fn<() => { where: typeof where }>();
  const select = vi.fn<() => { from: typeof from }>();
  const updateReconciliationFailure =
    vi.fn<(predicate: SQL | undefined) => Promise<unknown>>();
  const updateSet = vi.fn<
    (input: { lastReconciliationFailureAt: Date | null; updatedAt?: Date }) => {
      where: (predicate: SQL | undefined) => Promise<unknown>;
    }
  >();
  const update = vi.fn<() => { set: typeof updateSet }>();
  const getPolarSubscription = vi.fn<PolarClient["subscriptions"]["get"]>();
  const getPolarClient = vi.fn<typeof PolarModule.getPolarClient>();

  return {
    from,
    getPolarClient,
    getPolarSubscription,
    limit,
    loadRows,
    select,
    syncBillingSubscription:
      vi.fn<typeof SubscriptionSyncModule.syncBillingSubscription>(),
    update,
    updateReconciliationFailure,
    updateSet,
    where,
  };
});

// This fake implements only the database operations exercised by the test.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  return {
    assertDatabaseConfigured: actual.assertDatabaseConfigured,
    db: {
      select: () => ({
        from: (table: unknown) =>
          table === organization
            ? {
                innerJoin: () => ({
                  innerJoin: () => ({
                    leftJoin: () => ({
                      where: (predicate: SQL) => ({
                        limit: vi
                          .fn<() => Promise<{ userId: string }[]>>()
                          .mockResolvedValue(
                            new PgDialect()
                              .sqlToQuery(predicate)
                              .params.includes("organization-a")
                              ? [{ userId: "user-a" }]
                              : []
                          ),
                      }),
                    }),
                  }),
                }),
              }
            : billingMocks.from(),
      }),
      update: billingMocks.update,
    },
    withRequestDatabaseClient: actual.withRequestDatabaseClient,
  };
});

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal<typeof ServerEnvModule>();
  return {
    createServerEnv: actual.createServerEnv,
    requireServerEnv: actual.requireServerEnv,
    serverEnv: actual.createServerEnv({
      DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/quieter",
      NODE_ENV: "test",
      POLAR_ACCESS_TOKEN: "test-token",
      POLAR_PRODUCT_PRO_ID: "pro-product",
    }),
  };
});

vi.mock(import("../src/polar"), async (importOriginal) => {
  const actual = await importOriginal<typeof PolarModule>();
  polarState.getPolarClient = actual.getPolarClient;
  return {
    ...actual,
    getPolarClient: billingMocks.getPolarClient,
  };
});

vi.mock(import("../src/subscription-sync"), async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionSyncModule>();
  return {
    ...actual,
    syncBillingSubscription: billingMocks.syncBillingSubscription,
  };
});

describe("billing entitlement statuses", () => {
  test.each([
    { cancelAtPeriodEnd: true, status: "active" as const },
    { cancelAtPeriodEnd: false, status: "trialing" as const },
  ])(
    "ends access at the period boundary for $status, cancellation $cancelAtPeriodEnd",
    (subscription) => {
      const currentPeriodEnd = new Date("2026-08-03T00:00:00.000Z");
      expect(
        isActiveBillingSubscription(
          { ...subscription, currentPeriodEnd },
          new Date(currentPeriodEnd.getTime() - 1)
        )
      ).toBeTruthy();
      expect(
        isActiveBillingSubscription(
          { ...subscription, currentPeriodEnd },
          currentPeriodEnd
        )
      ).toBeFalsy();
      expect(
        isActiveBillingSubscription(
          { ...subscription, currentPeriodEnd },
          new Date(currentPeriodEnd.getTime() + 1)
        )
      ).toBeFalsy();
    }
  );
});

describe("billing subscription reconciliation", () => {
  const now = new Date("2026-08-02T00:00:00.000Z");

  test("checks a newly ended period even if a webhook arrived just before renewal", () => {
    expect(
      shouldReconcileBillingSubscription(
        {
          currentPeriodEnd: now,
          lastReconciliationFailureAt: null,
          updatedAt: new Date(now.getTime() - 60_000),
        },
        now
      )
    ).toBeTruthy();
  });
});

describe("organization subscription reconciliation", () => {
  beforeAll(async () => {
    // The Polar SDK ships thousands of generated modules; the first lazy load
    // inside a test can exceed the default timeout under load, so warm it here.
    await import("@polar-sh/sdk/2026-04");
  }, 30_000);

  const staleRow = {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
    currentPeriodStart: new Date("2026-06-23T00:00:00.000Z"),
    id: "subscription-row-a",
    lastReconciliationFailureAt: null,
    metadata: {
      quieterProduct: "pro",
      quieterScope: "account",
      quieterUserId: "user-a",
    },
    organizationId: null,
    plan: "pro" as const,
    provider: "polar" as const,
    providerCustomerId: "customer-a",
    providerModifiedAt: null,
    providerProductId: "pro-product",
    providerSubscriptionId: "polar-subscription-1",
    scope: "account" as const,
    status: "active" as const,
    updatedAt: new Date("2026-07-23T00:00:00.000Z"),
    userId: "user-a",
  };
  const refreshedRow = {
    ...staleRow,
    currentPeriodEnd: new Date("2027-01-23T00:00:00.000Z"),
    currentPeriodStart: new Date("2026-12-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    billingMocks.limit.mockResolvedValue([]);
    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
    billingMocks.where.mockReturnValue({
      limit: billingMocks.limit,
      orderBy: billingMocks.loadRows,
    });
    billingMocks.from.mockReturnValue({
      where: billingMocks.where,
    });
    billingMocks.select.mockReturnValue({
      from: billingMocks.from,
    });
    billingMocks.update.mockReturnValue({
      set: billingMocks.updateSet,
    });
    billingMocks.updateSet.mockReturnValue({
      where: billingMocks.updateReconciliationFailure,
    });
    billingMocks.getPolarClient.mockImplementation(async () => {
      const polar = await polarState.getPolarClient?.();
      if (polar === undefined || polar === null) {
        throw new Error("Polar client is unavailable in tests.");
      }

      vi.spyOn(polar.subscriptions, "get").mockImplementation(
        billingMocks.getPolarSubscription
      );
      return polar;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("denies allowance when reconciliation cannot confirm a new period", async () => {
    billingMocks.loadRows.mockResolvedValue([staleRow]);
    billingMocks.getPolarSubscription.mockResolvedValue(
      polarSubscription("polar-subscription-1")
    );
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: true });

    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toBeNull();
  });

  test.each([
    { providerModifiedAt: null, webhookRefresh: false },
    {
      providerModifiedAt: new Date("2026-07-22T00:00:00.000Z"),
      webhookRefresh: false,
    },
    { providerModifiedAt: null, webhookRefresh: true },
    {
      providerModifiedAt: new Date("2026-07-22T00:00:00.000Z"),
      webhookRefresh: true,
    },
  ])(
    "preserves definitive rejection after a concurrent timeout unless a newer webhook supersedes it",
    async ({ providerModifiedAt, webhookRefresh }) => {
      const database = new DatabaseSync(":memory:");
      try {
        database.exec(`create table "billingSubscription" (
        "id" text,
        "organizationId" text,
        "provider" text,
        "providerSubscriptionId" text,
        "updatedAt" text,
        "providerModifiedAt" text,
        "lastReconciliationFailureAt" text
      )`);
        database
          .prepare(
            'insert into "billingSubscription" values (?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            staleRow.id,
            "organization-a",
            "polar",
            refreshedRow.providerSubscriptionId,
            staleRow.updatedAt.toISOString(),
            providerModifiedAt?.toISOString() ?? null,
            null
          );
        billingMocks.loadRows.mockImplementation(
          async () =>
            await Promise.resolve([
              {
                ...refreshedRow,
                ...z
                  .object({
                    lastReconciliationFailureAt: z.coerce.date().nullable(),
                    providerModifiedAt: z.coerce.date().nullable(),
                    updatedAt: z.coerce.date(),
                  })
                  .parse(
                    database
                      .prepare('select * from "billingSubscription"')
                      .get()
                  ),
              },
            ])
        );
        billingMocks.updateSet.mockImplementation((values) => ({
          where: async (predicate) => {
            if (predicate === undefined) {
              throw new Error("Expected a conditional update.");
            }
            const query = new PgDialect().sqlToQuery(predicate);
            const parameters = z
              .array(z.string().nullable())
              .parse(query.params);
            return await Promise.resolve(
              database
                .prepare(
                  `update "billingSubscription" set "lastReconciliationFailureAt" = ?, "updatedAt" = coalesce(?, "updatedAt") where ${query.sql.replaceAll(/\$\d+/gu, "?")}`
                )
                .run(
                  values.lastReconciliationFailureAt?.toISOString() ?? null,
                  values.updatedAt?.toISOString() ?? null,
                  ...parameters
                )
            );
          },
        }));
        const timeout = Promise.withResolvers<Subscription>();
        const rejection = Promise.withResolvers<Subscription>();
        billingMocks.getPolarSubscription
          .mockReturnValueOnce(timeout.promise)
          .mockReturnValueOnce(rejection.promise);
        const transient = getOrganizationSubscription("organization-a");
        const definitive = getOrganizationSubscription("organization-a").catch(
          // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Attach rejection handling before completing either racing request.
          (error: unknown) => error
        );
        await vi.waitFor(() => {
          expect(billingMocks.getPolarSubscription).toHaveBeenCalledTimes(2);
        });
        timeout.reject(new PolarNetworkError("request timed out"));
        await expect(transient).resolves.toMatchObject({ product: "pro" });
        if (webhookRefresh) {
          database
            .prepare(
              'update "billingSubscription" set "providerModifiedAt" = ?'
            )
            .run(new Date().toISOString());
        }
        rejection.reject(new PolarClientError(404, "subscription not found"));
        await expect(definitive).resolves.toMatchObject({
          code: "SERVICE_UNAVAILABLE",
        });
        const nextOutcome = await getOrganizationSubscription(
          "organization-a"
        ).then(
          (account) => account?.product,
          (error: unknown) =>
            z.object({ code: z.literal("SERVICE_UNAVAILABLE") }).parse(error)
              .code
        );
        expect(nextOutcome).toBe(
          webhookRefresh ? "pro" : "SERVICE_UNAVAILABLE"
        );
      } finally {
        billingMocks.loadRows.mockReset();
        billingMocks.updateSet.mockReset();
        database.close();
      }
    }
  );

  test.each(["active", "trialing"] as const)(
    "preserves a current %s subscription during provider outages and cooldown",
    async (status) => {
      const row = {
        ...refreshedRow,
        status,
        updatedAt: staleRow.updatedAt,
      };
      billingMocks.loadRows.mockResolvedValue([row]);
      billingMocks.getPolarSubscription.mockRejectedValue(
        new PolarNetworkError("request timed out")
      );

      await expect(
        getOrganizationSubscription("organization-a")
      ).resolves.toMatchObject({ product: "pro" });

      billingMocks.loadRows.mockResolvedValue([
        { ...row, updatedAt: new Date() },
      ]);
      billingMocks.getPolarSubscription.mockClear();
      await expect(
        getOrganizationSubscription("organization-a")
      ).resolves.toMatchObject({ product: "pro" });
      expect(billingMocks.getPolarSubscription).not.toHaveBeenCalled();

      vi.setSystemTime(row.currentPeriodEnd);
      billingMocks.getPolarSubscription.mockRejectedValue(
        new PolarNetworkError("request timed out")
      );
      await expect(
        getOrganizationSubscription("organization-a")
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
  );

  test("denies current access when the provider rejects the request", async () => {
    billingMocks.loadRows.mockResolvedValue([refreshedRow]);
    billingMocks.getPolarSubscription.mockRejectedValue(
      new PolarClientError(404, "subscription not found")
    );

    await expect(
      getOrganizationSubscriptionRecord("organization-a", {
        forceReconcile: true,
      })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    billingMocks.loadRows.mockResolvedValue([
      { ...refreshedRow, lastReconciliationFailureAt: new Date() },
    ]);
    billingMocks.getPolarSubscription.mockClear();
    await expect(
      getOrganizationSubscription("organization-a")
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(billingMocks.getPolarSubscription).not.toHaveBeenCalled();
  });

  test.each([
    new PolarServerError(503, "provider unavailable"),
    new PolarRateLimitError(429),
  ])(
    "preserves current access during transient provider responses",
    async (providerError) => {
      billingMocks.loadRows.mockResolvedValue([
        { ...refreshedRow, updatedAt: staleRow.updatedAt },
      ]);
      billingMocks.getPolarSubscription.mockRejectedValue(providerError);

      await expect(
        getOrganizationSubscription("organization-a")
      ).resolves.toMatchObject({ product: "pro" });
    }
  );

  test("retains fail-closed historical failures during provider outages", async () => {
    billingMocks.loadRows.mockResolvedValue([
      {
        ...refreshedRow,
        lastReconciliationFailureAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    ]);
    billingMocks.getPolarSubscription.mockRejectedValue(
      new PolarNetworkError("request timed out")
    );

    await expect(
      getOrganizationSubscription("organization-a")
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  test("observes a concurrent cancellation before returning cached access", async () => {
    billingMocks.loadRows
      .mockResolvedValueOnce([
        { ...refreshedRow, updatedAt: staleRow.updatedAt },
      ])
      .mockResolvedValueOnce([{ ...refreshedRow, status: "canceled" }]);
    billingMocks.getPolarSubscription.mockRejectedValue(
      new PolarNetworkError("request timed out")
    );

    await expect(
      getOrganizationSubscription("organization-a")
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  test.each([{ synced: false }, { ignored: true, synced: true }])(
    "denies current access when synchronization rejects the subscription",
    async (syncResult) => {
      billingMocks.loadRows.mockResolvedValue([
        { ...refreshedRow, updatedAt: staleRow.updatedAt },
      ]);
      billingMocks.getPolarSubscription.mockResolvedValue(
        polarSubscription("polar-subscription-1")
      );
      billingMocks.syncBillingSubscription.mockResolvedValue(syncResult);

      await expect(
        getOrganizationSubscription("organization-a")
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
  );

  test("denies current access when the provider subscription belongs to another account", async () => {
    billingMocks.loadRows.mockResolvedValue([
      { ...refreshedRow, updatedAt: staleRow.updatedAt },
    ]);
    billingMocks.getPolarSubscription.mockResolvedValue(
      polarSubscriptionSchema.parse({
        id: "polar-subscription-1",
        metadata: { quieterScope: "account", quieterUserId: "user-b" },
      })
    );

    await expect(
      getOrganizationSubscription("organization-a")
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(billingMocks.syncBillingSubscription).not.toHaveBeenCalled();
  });

  test("recovers a past-due subscription when the recovery webhook was missed", async () => {
    billingMocks.loadRows
      .mockResolvedValueOnce([{ ...staleRow, status: "past_due" }])
      .mockResolvedValueOnce([refreshedRow]);
    billingMocks.getPolarSubscription.mockResolvedValue(
      polarSubscription("polar-subscription-1")
    );
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: true });
    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toMatchObject({ product: "pro" });
  });

  test("revokes a current period when a cancellation webhook was missed", async () => {
    billingMocks.loadRows
      .mockResolvedValueOnce([
        { ...refreshedRow, updatedAt: staleRow.updatedAt },
      ])
      .mockResolvedValueOnce([{ ...refreshedRow, status: "canceled" }]);
    billingMocks.getPolarSubscription.mockResolvedValue(
      polarSubscription("polar-subscription-1")
    );
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: true });
    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toBeNull();
    expect(billingMocks.getPolarSubscription).toHaveBeenCalledOnce();
  });

  test("keeps access until a scheduled cancellation reaches the period end", async () => {
    billingMocks.loadRows.mockResolvedValue([
      { ...refreshedRow, cancelAtPeriodEnd: true },
    ]);
    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toMatchObject({ product: "pro" });
    expect(billingMocks.getPolarSubscription).not.toHaveBeenCalled();
  });

  test("selects a current subscription ahead of a stale active subscription", async () => {
    billingMocks.loadRows.mockResolvedValue([
      { ...staleRow, updatedAt: new Date() },
      refreshedRow,
    ]);
    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toMatchObject({
      currentPeriodEnd: refreshedRow.currentPeriodEnd,
    });
    expect(billingMocks.getPolarSubscription).not.toHaveBeenCalled();
  });

  test("ignores subscriptions belonging to another organization", async () => {
    billingMocks.loadRows.mockResolvedValue([staleRow]);
    await expect(
      getOrganizationSubscription("organization-b")
    ).resolves.toBeNull();
    expect(billingMocks.getPolarSubscription).not.toHaveBeenCalled();
  });
});

describe("local development billing entitlement", () => {
  test("fakes paid access only with an explicit local opt-in", () => {
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      })
    ).toBeTruthy();
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_BILLING_BYPASS: undefined,
      })
    ).toBeFalsy();
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        QUIETER_DEPLOYMENT_ENV: "production",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      })
    ).toBeFalsy();
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "https://quieter.email",
        NODE_ENV: "production",
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      })
    ).toBeFalsy();
  });
});
