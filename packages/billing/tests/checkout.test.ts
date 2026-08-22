import type { Checkout } from "@polar-sh/sdk/models/components/checkout.js";
import type { Customer } from "@polar-sh/sdk/models/components/customer.js";
import type * as DatabaseClientModule from "@quieter/database/client";
import type * as ServerEnvModule from "@quieter/env/server";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import { createBillingCheckout } from "../src";
import type * as PolarModule from "../src/polar";
import type * as SubscriptionSyncModule from "../src/subscription-sync";

type PolarClient = Awaited<ReturnType<typeof PolarModule.getPolarClient>>;

const polarCustomerSchema = z.custom<Customer>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
);

const polarCheckoutSchema = z.custom<Checkout>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string"
);

const polarCustomer = (id: string) => polarCustomerSchema.parse({ id });

const polarCheckout = (url: string) => polarCheckoutSchema.parse({ url });

const polarState = vi.hoisted(() => ({
  getPolarClient: null as typeof PolarModule.getPolarClient | null,
}));

const checkoutMocks = vi.hoisted(() => {
  const limit = vi.fn<() => Promise<{ name: string }[]>>();
  const orderBy = vi.fn<() => Promise<unknown[]>>();
  const where = vi.fn<() => { limit: typeof limit; orderBy: typeof orderBy }>();
  const from = vi.fn<() => { where: typeof where }>();
  const select = vi.fn<() => { from: typeof from }>();

  return {
    createCheckout: vi.fn<PolarClient["checkouts"]["create"]>(),
    from,
    getExternalCustomer: vi.fn<PolarClient["customers"]["getExternal"]>(),
    limit,
    loadOrganization: vi.fn<() => Promise<{ name: string }[]>>(),
    loadSubscriptions: vi.fn<() => Promise<unknown[]>>(),
    orderBy,
    select,
    syncBillingSubscription:
      vi.fn<typeof SubscriptionSyncModule.syncBillingSubscription>(),
    where,
  };
});

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  return {
    assertDatabaseConfigured: actual.assertDatabaseConfigured,
    db: Object.assign(actual.db, {
      select: checkoutMocks.select,
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
      POLAR_PRODUCT_MANAGED_ID: "managed-product",
      POLAR_PRODUCT_PRO_ID: "pro-product",
    }),
  };
});

vi.mock(import("../src/polar"), async (importOriginal) => {
  const actual = await importOriginal<typeof PolarModule>();
  polarState.getPolarClient = actual.getPolarClient;
  return {
    ...actual,
    getPolarApiOrganizationId: vi.fn<() => string>(),
    getPolarClient: vi.fn<typeof actual.getPolarClient>(async () => {
      const polar = await polarState.getPolarClient?.();
      if (polar === undefined || polar === null) {
        throw new Error("Polar client is unavailable in tests.");
      }

      vi.spyOn(polar.checkouts, "create").mockImplementation(
        checkoutMocks.createCheckout
      );
      vi.spyOn(polar.customers, "getExternal").mockImplementation(
        checkoutMocks.getExternalCustomer
      );
      return polar;
    }),
  };
});

vi.mock(import("../src/subscription-sync"), async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionSyncModule>();
  return {
    ...actual,
    syncBillingSubscription: checkoutMocks.syncBillingSubscription,
  };
});

describe("Polar checkout creation", () => {
  beforeAll(async () => {
    // The Polar SDK ships thousands of generated modules; the first lazy load
    // inside a test can exceed the default timeout under load, so warm it here.
    await import("@polar-sh/sdk");
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    checkoutMocks.where.mockReturnValue({
      limit: checkoutMocks.limit,
      orderBy: checkoutMocks.orderBy,
    });
    checkoutMocks.from.mockReturnValue({
      where: checkoutMocks.where,
    });
    checkoutMocks.select.mockReturnValue({
      from: checkoutMocks.from,
    });
    checkoutMocks.loadOrganization.mockResolvedValue([
      { name: "Default team" },
    ]);
    checkoutMocks.limit.mockImplementation(
      async () => await checkoutMocks.loadOrganization()
    );
    checkoutMocks.orderBy.mockImplementation(
      async () => await checkoutMocks.loadSubscriptions()
    );
    checkoutMocks.getExternalCustomer.mockResolvedValue(
      polarCustomer("customer-1")
    );
    checkoutMocks.createCheckout.mockResolvedValue(
      polarCheckout("https://polar.sh/checkout/checkout-1")
    );
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
      })
    ).resolves.toStrictEqual({
      checkoutUrl: "https://polar.sh/checkout/checkout-1",
    });
    const checkoutRequest = checkoutMocks.createCheckout.mock.calls.at(0)?.[0];
    expect(checkoutRequest?.successUrl).toContain("checkoutId={CHECKOUT_ID}");
  });
});
