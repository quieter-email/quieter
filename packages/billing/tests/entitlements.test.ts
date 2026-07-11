import { describe, expect, test } from "vite-plus/test";
import {
  isActiveBillingStatus,
  isLocalDevelopmentBillingEntitlementEnabled,
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
        NODE_ENV: "development",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(true);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        NODE_ENV: "development",
        QUIETER_LOCAL_BILLING_BYPASS: undefined,
        QUIETER_DEPLOYMENT_ENV: "local",
      }),
    ).toBe(false);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        NODE_ENV: "development",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
        NODE_ENV: "production",
        QUIETER_LOCAL_BILLING_BYPASS: true,
        QUIETER_DEPLOYMENT_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      isLocalDevelopmentBillingEntitlementEnabled({
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

  test("keeps a platform fee above the included monthly credits", () => {
    expect(BILLING_PRODUCTS.managed).toMatchObject({
      creditAmountCents: 1_000,
      monthlyPriceCents: 1_500,
    });
    expect(BILLING_PRODUCTS.pro).toMatchObject({
      creditAmountCents: 2_000,
      monthlyPriceCents: 2_500,
    });
  });
});
