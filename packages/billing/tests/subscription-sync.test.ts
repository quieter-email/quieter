import type * as DatabaseClientModule from "@quieter/database/client";
import type { billingSubscription } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { syncBillingSubscription } from "../src/subscription-sync";
import type { BillingPolarSubscription } from "../src/subscription-sync";

const mocks = vi.hoisted(() => ({
  deploymentEnvironment: "production" as "production" | "local",
  upsert: vi.fn<() => Promise<void>>(),
  values: vi.fn<
    (input: typeof billingSubscription.$inferInsert) => {
      onConflictDoUpdate: () => Promise<void>;
    }
  >(),
}));

vi.mock(import("@quieter/env/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      get QUIETER_DEPLOYMENT_ENV() {
        return mocks.deploymentEnvironment;
      },
    },
  };
});

// This fake implements only the database operations exercised by the test.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("@quieter/database/client", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  return {
    ...actual,
    db: { insert: () => ({ values: mocks.values }) },
  };
});

const subscriptionSchema = z.custom<BillingPolarSubscription>(
  (value) => typeof value === "object" && value !== null && "id" in value
);

const subscription = subscriptionSchema.parse({
  amount: 0,
  cancel_at_period_end: false,
  created_at: "2026-08-01T00:00:00.000Z",
  current_period_end: "2026-10-01T00:00:00.000Z",
  current_period_start: "2026-09-01T00:00:00.000Z",
  customer_id: "customer-a",
  id: "subscription-a",
  metadata: {
    quieterOrganizationId: "team-a",
    quieterProduct: "managed",
    quieterUserId: "user-a",
  },
  modified_at: "2026-09-01T00:00:00.000Z",
  product: { metadata: {} },
  product_id: "product-a",
  status: "active",
});

describe("subscription synchronization", () => {
  beforeEach(() => {
    mocks.deploymentEnvironment = "production";
    vi.clearAllMocks();
    mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.upsert });
  });

  test("ignores development subscriptions in a deployed environment", async () => {
    await expect(
      syncBillingSubscription({
        ...subscription,
        metadata: { ...subscription.metadata, quieterEnvironment: "local" },
      })
    ).resolves.toMatchObject({ ignored: true, synced: true });
    expect(mocks.values).not.toHaveBeenCalled();
  });

  test("ignores another deployment's subscription in local development", async () => {
    mocks.deploymentEnvironment = "local";
    await expect(syncBillingSubscription(subscription)).resolves.toMatchObject({
      ignored: true,
      synced: true,
    });
    expect(mocks.values).not.toHaveBeenCalled();
  });

  test("applies a subscription explicitly created by local development", async () => {
    mocks.deploymentEnvironment = "local";
    await expect(
      syncBillingSubscription({
        ...subscription,
        metadata: { ...subscription.metadata, quieterEnvironment: "local" },
      })
    ).resolves.toStrictEqual({ synced: true });
    expect(mocks.values).toHaveBeenCalledOnce();
  });

  test("renews the billing period for a zero-amount subscription", async () => {
    await expect(syncBillingSubscription(subscription)).resolves.toStrictEqual({
      synced: true,
    });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPeriodEnd: new Date(subscription.current_period_end),
        currentPeriodStart: new Date(subscription.current_period_start),
        status: "active",
      })
    );
  });

  test("stores scheduled cancellation without ending access early", async () => {
    await syncBillingSubscription({
      ...subscription,
      cancel_at_period_end: true,
    });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAtPeriodEnd: true, status: "active" })
    );
  });

  test("stores immediate revocation despite a future billing period end", async () => {
    await syncBillingSubscription({ ...subscription, status: "canceled" });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" })
    );
  });

  test("dates an unmodified creation event so it cannot overwrite a later cancellation", async () => {
    await syncBillingSubscription({ ...subscription, modified_at: null });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        providerModifiedAt: new Date(subscription.created_at),
      })
    );
  });

  test("does not apply a subscription without team ownership metadata", async () => {
    await expect(
      syncBillingSubscription({
        ...subscription,
        metadata: { quieterProduct: "managed", quieterUserId: "user-a" },
      })
    ).resolves.toStrictEqual({ synced: false });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
