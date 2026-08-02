import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const checkoutMocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  getExternalCustomer: vi.fn(),
  loadOrganization: vi.fn(),
  loadSubscriptions: vi.fn(),
}));

vi.mock("@quieter/database/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: checkoutMocks.loadOrganization,
          orderBy: checkoutMocks.loadSubscriptions,
        })),
      })),
    })),
  },
}));

vi.mock("@quieter/env/server", () => ({
  serverEnv: {
    NODE_ENV: "test",
    POLAR_PRODUCT_MANAGED_ID: "managed-product",
    POLAR_PRODUCT_PRO_ID: "pro-product",
  },
}));

vi.mock("../src/polar", () => ({
  getPolarApiOrganizationId: vi.fn(),
  getPolarClient: () => ({
    checkouts: { create: checkoutMocks.createCheckout },
    customers: { getExternal: checkoutMocks.getExternalCustomer },
  }),
}));

vi.mock("../src/subscription-sync", () => ({
  BILLING_METADATA_ORGANIZATION_ID: "quieterOrganizationId",
  BILLING_METADATA_PRODUCT: "quieterProduct",
  BILLING_METADATA_USER_ID: "quieterUserId",
  syncBillingSubscription: vi.fn(),
}));

import { createBillingCheckout } from "../src";

describe("Polar checkout creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkoutMocks.loadOrganization.mockResolvedValue([{ name: "Default team" }]);
    checkoutMocks.getExternalCustomer.mockResolvedValue({ id: "customer-1" });
    checkoutMocks.createCheckout.mockResolvedValue({ url: "https://polar.sh/checkout/checkout-1" });
  });

  test("creates a new checkout when the stored active subscription period has expired", async () => {
    checkoutMocks.loadSubscriptions.mockResolvedValue([
      {
        currentPeriodEnd: new Date("2026-07-23T00:00:00.000Z"),
        metadata: { quieterOrganizationId: "organization-1" },
        plan: "pro",
        providerSubscriptionId: "subscription-1",
        status: "active",
        updatedAt: new Date("2026-07-23T00:00:00.000Z"),
      },
    ]);

    await expect(
      createBillingCheckout({
        customerEmail: "owner@example.com",
        customerName: "Owner",
        headers: new Headers({ origin: "https://quieter.email" }),
        organizationId: "organization-1",
        product: "pro",
        userId: "user-1",
      }),
    ).resolves.toEqual({ checkoutUrl: "https://polar.sh/checkout/checkout-1" });
    expect(checkoutMocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: expect.stringContaining("checkoutId={CHECKOUT_ID}"),
      }),
    );
  });
});
