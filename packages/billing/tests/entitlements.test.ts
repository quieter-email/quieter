import { describe, expect, test } from "bun:test";
import {
  isActiveBillingStatus,
  resolveOrganizationBillingEntitlement,
  resolveOrganizationBillingOwnerId,
} from "../src/entitlements";

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

describe("organization billing owner resolution", () => {
  test("keeps the persisted billing owner", async () => {
    let assigned = false;
    const result = await resolveOrganizationBillingOwnerId("organization-1", {
      assignBillingOwnerId: async () => {
        assigned = true;
        return null;
      },
      getBillingOwnerId: async () => "billing-owner",
      getFirstOwnerId: async () => "first-owner",
    });

    expect(result).toBe("billing-owner");
    expect(assigned).toBe(false);
  });

  test("backfills the first owner when no billing owner exists", async () => {
    let currentBillingOwnerId: string | null = null;
    const result = await resolveOrganizationBillingOwnerId("organization-1", {
      assignBillingOwnerId: async ({ userId }) => {
        currentBillingOwnerId = userId;
        return userId;
      },
      getBillingOwnerId: async () => currentBillingOwnerId,
      getFirstOwnerId: async () => "first-owner",
    });

    expect(result).toBe("first-owner");
  });

  test("uses the concurrently assigned billing owner after a conditional update miss", async () => {
    let readCount = 0;
    const result = await resolveOrganizationBillingOwnerId("organization-1", {
      assignBillingOwnerId: async () => null,
      getBillingOwnerId: async () => {
        readCount += 1;
        return readCount === 1 ? null : "concurrent-owner";
      },
      getFirstOwnerId: async () => "first-owner",
    });

    expect(result).toBe("concurrent-owner");
  });
});

describe("organization billing entitlement resolution", () => {
  const activeProSubscription = {
    currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
    plan: "pro" as const,
    status: "active" as const,
    updatedAt: new Date("2026-06-20T00:00:00.000Z"),
  };

  test("gives an administrative override precedence over subscriptions", () => {
    const result = resolveOrganizationBillingEntitlement({
      billingOwnerId: "billing-owner",
      overridePlan: "managed",
      requiredPlan: "pro",
      subscriptions: [activeProSubscription],
    });

    expect(result).toMatchObject({
      billingUserId: "billing-owner",
      hasAccess: false,
      hasUnlimitedAccess: true,
      plan: "managed",
    });
  });

  test("uses an active eligible subscription without an override", () => {
    const result = resolveOrganizationBillingEntitlement({
      billingOwnerId: "billing-owner",
      overridePlan: null,
      requiredPlan: "managed",
      subscriptions: [activeProSubscription],
    });

    expect(result).toMatchObject({
      billingUserId: "billing-owner",
      hasAccess: true,
      hasUnlimitedAccess: false,
      plan: "pro",
    });
  });
});
