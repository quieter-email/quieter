import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import type * as DatabaseClientModule from "@quieter/database/client";
import type * as ServerEnvModule from "@quieter/env/server";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import {
  getOrganizationSubscription,
  isActiveBillingSubscription,
  isActiveBillingStatus,
  isLocalDevelopmentBillingEntitlementEnabled,
  shouldReconcileExpiredBillingSubscription,
  subscriptionBelongsToOrganization,
} from "../src/entitlements";
import {
  BILLING_PRODUCTS,
  productHasAi,
  productHasManagedMail,
} from "../src/plans";
import type * as PolarModule from "../src/polar";
import type * as SubscriptionSyncModule from "../src/subscription-sync";

type PolarClient = ReturnType<typeof PolarModule.getPolarClient>;

const polarSubscriptionSchema = z.custom<Subscription>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
);

const polarSubscription = (id: string) => polarSubscriptionSchema.parse({ id });

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
  const updateReconciliationFailure = vi.fn<() => Promise<unknown>>();
  const updateSet = vi.fn<
    (input: { lastReconciliationFailureAt: Date }) => {
      where: typeof updateReconciliationFailure;
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

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  return {
    assertDatabaseConfigured: actual.assertDatabaseConfigured,
    db: Object.assign(actual.db, {
      select: billingMocks.select,
      update: billingMocks.update,
    }),
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
  test("grants access only after payment is active or trialing", () => {
    expect({
      active: isActiveBillingStatus("active"),
      canceled: isActiveBillingStatus("canceled"),
      expired: isActiveBillingStatus("expired"),
      pastDue: isActiveBillingStatus("past_due"),
      pending: isActiveBillingStatus("pending"),
      trialing: isActiveBillingStatus("trialing"),
    }).toStrictEqual({
      active: true,
      canceled: false,
      expired: false,
      pastDue: false,
      pending: false,
      trialing: true,
    });
  });

  test("requires an active status with a current billing period", () => {
    const now = new Date("2026-08-02T00:00:00.000Z");

    expect(
      isActiveBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-08-03T00:00:00.000Z"),
          status: "active",
        },
        now
      )
    ).toBeTruthy();
    expect(
      isActiveBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
          status: "active",
        },
        now
      )
    ).toBeFalsy();
    expect(
      isActiveBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-08-03T00:00:00.000Z"),
          status: "canceled",
        },
        now
      )
    ).toBeFalsy();
  });
});

describe("expired billing subscription reconciliation", () => {
  const now = new Date("2026-08-02T00:00:00.000Z");

  test("reconciles an expired period after the retry window", () => {
    expect(
      shouldReconcileExpiredBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
          lastReconciliationFailureAt: null,
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
        now
      )
    ).toBeTruthy();
  });

  test("does not reconcile a current or recently refreshed period", () => {
    expect(
      shouldReconcileExpiredBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-08-03T00:00:00.000Z"),
          lastReconciliationFailureAt: null,
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
        now
      )
    ).toBeFalsy();
    expect(
      shouldReconcileExpiredBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
          lastReconciliationFailureAt: null,
          updatedAt: new Date("2026-08-01T23:58:00.000Z"),
        },
        now
      )
    ).toBeFalsy();
  });

  test("uses a recent reconciliation failure for the retry window", () => {
    expect(
      shouldReconcileExpiredBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
          lastReconciliationFailureAt: new Date("2026-08-01T23:58:00.000Z"),
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
        now
      )
    ).toBeFalsy();
  });
});

describe("organization subscription reconciliation", () => {
  const staleRow = {
    currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
    currentPeriodStart: new Date("2026-06-23T00:00:00.000Z"),
    lastReconciliationFailureAt: null,
    metadata: { quieterOrganizationId: "organization-a" },
    plan: "pro" as const,
    provider: "polar" as const,
    providerSubscriptionId: "polar-subscription-1",
    status: "active" as const,
    updatedAt: new Date("2026-07-23T00:00:00.000Z"),
  };
  const refreshedRow = {
    ...staleRow,
    currentPeriodEnd: new Date("2026-08-23T00:00:00.000Z"),
    currentPeriodStart: new Date("2026-07-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
    billingMocks.getPolarClient.mockImplementation(() => {
      const polar = polarState.getPolarClient?.();
      if (polar === undefined || polar === null) {
        throw new Error("Polar client is unavailable in tests.");
      }

      vi.spyOn(polar.subscriptions, "get").mockImplementation(
        billingMocks.getPolarSubscription
      );
      return polar;
    });
  });

  test("force-syncs an expired Polar subscription and reloads the row", async () => {
    const providerSubscription = polarSubscription("polar-subscription-1");
    billingMocks.loadRows
      .mockResolvedValueOnce([staleRow])
      .mockResolvedValueOnce([refreshedRow]);
    billingMocks.getPolarSubscription.mockResolvedValue(providerSubscription);
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: true });

    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toMatchObject({
      currentPeriodEnd: refreshedRow.currentPeriodEnd,
    });
    const polarCall = billingMocks.getPolarSubscription.mock.calls.at(0);
    expect(polarCall?.[0]).toStrictEqual({ id: "polar-subscription-1" });
    const polarOptions = polarCall?.[1];
    expect(polarOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(billingMocks.syncBillingSubscription).toHaveBeenCalledWith(
      providerSubscription,
      {
        force: true,
      }
    );
    expect(billingMocks.loadRows).toHaveBeenCalledTimes(2);
  });

  test("fails closed when Polar still returns an expired period", async () => {
    billingMocks.loadRows.mockResolvedValue([staleRow]);
    billingMocks.getPolarSubscription.mockResolvedValue(
      polarSubscription("polar-subscription-1")
    );
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: true });

    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toBeNull();
    expect(billingMocks.loadRows).toHaveBeenCalledTimes(2);
  });

  test("fails closed during the reconciliation cooldown", async () => {
    billingMocks.loadRows.mockResolvedValueOnce([
      { ...staleRow, lastReconciliationFailureAt: new Date() },
    ]);

    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toBeNull();
    expect(billingMocks.getPolarSubscription).not.toHaveBeenCalled();
  });

  test("fails closed when reconciliation is unsynced", async () => {
    billingMocks.loadRows.mockResolvedValueOnce([staleRow]);
    billingMocks.getPolarSubscription.mockResolvedValue(
      polarSubscription("polar-subscription-1")
    );
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: false });

    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toBeNull();
    expect(billingMocks.updateSet).toHaveBeenCalledOnce();
    const reconciliationUpdate = billingMocks.updateSet.mock.calls[0]?.[0];
    expect(reconciliationUpdate?.lastReconciliationFailureAt).toBeInstanceOf(
      Date
    );
  });

  test("fails closed when reconciliation throws", async () => {
    billingMocks.loadRows.mockResolvedValueOnce([staleRow]);
    billingMocks.getPolarSubscription.mockRejectedValue(
      new Error("provider unavailable")
    );

    await expect(
      getOrganizationSubscription("organization-a")
    ).resolves.toBeNull();
    expect(billingMocks.updateSet).toHaveBeenCalledOnce();
    const reconciliationUpdate = billingMocks.updateSet.mock.calls[0]?.[0];
    expect(reconciliationUpdate?.lastReconciliationFailureAt).toBeInstanceOf(
      Date
    );
  });
});

describe("organization subscription ownership", () => {
  test("requires subscription metadata for the exact team", () => {
    expect(
      subscriptionBelongsToOrganization(
        { quieterOrganizationId: "organization-a" },
        "organization-a"
      )
    ).toBeTruthy();
    expect(
      subscriptionBelongsToOrganization(
        { quieterOrganizationId: "organization-a" },
        "organization-b"
      )
    ).toBeFalsy();
    expect(subscriptionBelongsToOrganization({}, "organization-a")).toBeFalsy();
    expect(
      subscriptionBelongsToOrganization(null, "organization-a")
    ).toBeFalsy();
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
        QUIETER_DEPLOYMENT_ENV: "preview",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      })
    ).toBeFalsy();
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "https://review.quieter.email",
        NODE_ENV: "production",
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      })
    ).toBeFalsy();
  });

  test("allows loopback production hosts when local billing bypass is enabled", () => {
    expect({
      ipv6Loopback: isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://[::1]:3000",
        NODE_ENV: "production",
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      }),
      localhostProduction: isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "production",
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      }),
      testEnvironment: isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
        QUIETER_DEPLOYMENT_ENV: "local",
        QUIETER_LOCAL_BILLING_BYPASS: true,
      }),
    }).toStrictEqual({
      ipv6Loopback: true,
      localhostProduction: true,
      testEnvironment: false,
    });
  });
});

describe("billing products", () => {
  test("exposes only organization plans", () => {
    expect(Object.keys(BILLING_PRODUCTS)).toStrictEqual(["managed", "pro"]);
  });

  test("matches product access to the purchased capability", () => {
    expect(productHasAi("managed")).toBeFalsy();
    expect(productHasAi("pro")).toBeTruthy();
    expect(productHasManagedMail("managed")).toBeTruthy();
    expect(productHasManagedMail("pro")).toBeTruthy();
  });

  test("keeps a platform fee above the included monthly usage balance", () => {
    expect(BILLING_PRODUCTS.managed).toMatchObject({
      creditAmountCents: 1000,
      currency: "usd",
      monthlyPriceCents: 1500,
    });
    expect(BILLING_PRODUCTS.pro).toMatchObject({
      creditAmountCents: 2000,
      currency: "usd",
      monthlyPriceCents: 2500,
    });
  });
});
