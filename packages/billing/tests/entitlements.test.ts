import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const billingMocks = vi.hoisted(() => ({
  getPolarClient: vi.fn(),
  getPolarSubscription: vi.fn(),
  loadRows: vi.fn(),
  syncBillingSubscription: vi.fn(),
  updateReconciliationFailure: vi.fn(),
  updateReconciliationFailureSet: vi.fn(),
}));

vi.mock("@quieter/database/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(),
          orderBy: billingMocks.loadRows,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: billingMocks.updateReconciliationFailureSet.mockImplementation(() => ({
        where: billingMocks.updateReconciliationFailure,
      })),
    })),
  },
}));

vi.mock("../src/polar", () => ({
  getPolarClient: billingMocks.getPolarClient,
}));

vi.mock("../src/subscription-sync", () => ({
  syncBillingSubscription: billingMocks.syncBillingSubscription,
}));

import {
  getOrganizationSubscription,
  isActiveBillingStatus,
  isLocalDevelopmentBillingEntitlementEnabled,
  shouldReconcileExpiredBillingSubscription,
  subscriptionBelongsToOrganization,
} from "../src/entitlements";
import { BILLING_PRODUCTS, productHasAi, productHasManagedMail } from "../src/plans";

describe("billing entitlement statuses", () => {
  test("grants access only after payment is active or trialing", () => {
    expect(isActiveBillingStatus("active")).toBe(true);
    expect(isActiveBillingStatus("trialing")).toBe(true);
    expect(isActiveBillingStatus("pending")).toBe(false);
    expect(isActiveBillingStatus("past_due")).toBe(false);
    expect(isActiveBillingStatus("canceled")).toBe(false);
    expect(isActiveBillingStatus("expired")).toBe(false);
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
        now,
      ),
    ).toBe(true);
  });

  test("does not reconcile a current or recently refreshed period", () => {
    expect(
      shouldReconcileExpiredBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-08-03T00:00:00.000Z"),
          lastReconciliationFailureAt: null,
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldReconcileExpiredBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
          lastReconciliationFailureAt: null,
          updatedAt: new Date("2026-08-01T23:58:00.000Z"),
        },
        now,
      ),
    ).toBe(false);
  });

  test("uses a recent reconciliation failure for the retry window", () => {
    expect(
      shouldReconcileExpiredBillingSubscription(
        {
          currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
          lastReconciliationFailureAt: new Date("2026-08-01T23:58:00.000Z"),
          updatedAt: new Date("2026-07-23T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe(false);
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
    billingMocks.getPolarClient.mockReturnValue({
      subscriptions: { get: billingMocks.getPolarSubscription },
    });
  });

  test("force-syncs an expired Polar subscription and reloads the row", async () => {
    const providerSubscription = { id: "polar-subscription-1" };
    billingMocks.loadRows.mockResolvedValueOnce([staleRow]).mockResolvedValueOnce([refreshedRow]);
    billingMocks.getPolarSubscription.mockResolvedValue(providerSubscription);
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: true });

    await expect(getOrganizationSubscription("organization-a")).resolves.toMatchObject({
      currentPeriodEnd: refreshedRow.currentPeriodEnd,
    });
    expect(billingMocks.getPolarSubscription).toHaveBeenCalledWith(
      { id: "polar-subscription-1" },
      { signal: expect.any(AbortSignal) },
    );
    expect(billingMocks.syncBillingSubscription).toHaveBeenCalledWith(providerSubscription, {
      force: true,
    });
    expect(billingMocks.loadRows).toHaveBeenCalledTimes(2);
  });

  test("fails closed when Polar still returns an expired period", async () => {
    billingMocks.loadRows.mockResolvedValue([staleRow]);
    billingMocks.getPolarSubscription.mockResolvedValue({ id: "polar-subscription-1" });
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: true });

    await expect(getOrganizationSubscription("organization-a")).resolves.toBeNull();
    expect(billingMocks.loadRows).toHaveBeenCalledTimes(2);
  });

  test("fails closed during the reconciliation cooldown", async () => {
    billingMocks.loadRows.mockResolvedValueOnce([
      { ...staleRow, lastReconciliationFailureAt: new Date() },
    ]);

    await expect(getOrganizationSubscription("organization-a")).resolves.toBeNull();
    expect(billingMocks.getPolarSubscription).not.toHaveBeenCalled();
  });

  test("fails closed when reconciliation is unsynced", async () => {
    billingMocks.loadRows.mockResolvedValueOnce([staleRow]);
    billingMocks.getPolarSubscription.mockResolvedValue({ id: "polar-subscription-1" });
    billingMocks.syncBillingSubscription.mockResolvedValue({ synced: false });

    await expect(getOrganizationSubscription("organization-a")).resolves.toBeNull();
    expect(billingMocks.updateReconciliationFailureSet).toHaveBeenCalledWith({
      lastReconciliationFailureAt: expect.any(Date),
    });
  });

  test("fails closed when reconciliation throws", async () => {
    billingMocks.loadRows.mockResolvedValueOnce([staleRow]);
    billingMocks.getPolarSubscription.mockRejectedValue(new Error("provider unavailable"));

    await expect(getOrganizationSubscription("organization-a")).resolves.toBeNull();
    expect(billingMocks.updateReconciliationFailureSet).toHaveBeenCalledWith({
      lastReconciliationFailureAt: expect.any(Date),
    });
  });
});

describe("organization subscription ownership", () => {
  test("requires subscription metadata for the exact team", () => {
    expect(
      subscriptionBelongsToOrganization(
        { quieterOrganizationId: "organization-a" },
        "organization-a",
      ),
    ).toBe(true);
    expect(
      subscriptionBelongsToOrganization(
        { quieterOrganizationId: "organization-a" },
        "organization-b",
      ),
    ).toBe(false);
    expect(subscriptionBelongsToOrganization({}, "organization-a")).toBe(false);
    expect(subscriptionBelongsToOrganization(null, "organization-a")).toBe(false);
  });
});

describe("local development billing entitlement", () => {
  test("fakes paid access only with an explicit local opt-in", () => {
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(true);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        QUIETER_LOCAL_BILLING_BYPASS: undefined,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(false);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "development",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "https://review.quieter.email",
        NODE_ENV: "production",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(false);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "production",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(true);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://[::1]:3000",
        NODE_ENV: "production",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(true);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        BETTER_AUTH_URL: "http://localhost:3000",
        NODE_ENV: "test",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(false);
  });
});

describe("billing products", () => {
  test("exposes only organization plans", () => {
    expect(Object.keys(BILLING_PRODUCTS)).toEqual(["managed", "pro"]);
  });

  test("matches product access to the purchased capability", () => {
    expect(productHasAi("managed")).toBe(false);
    expect(productHasAi("pro")).toBe(true);
    expect(productHasManagedMail("managed")).toBe(true);
    expect(productHasManagedMail("pro")).toBe(true);
  });

  test("keeps a platform fee above the included monthly usage balance", () => {
    expect(BILLING_PRODUCTS.managed).toMatchObject({
      creditAmountCents: 1_000,
      currency: "usd",
      monthlyPriceCents: 1_500,
    });
    expect(BILLING_PRODUCTS.pro).toMatchObject({
      creditAmountCents: 2_000,
      currency: "usd",
      monthlyPriceCents: 2_500,
    });
  });
});
