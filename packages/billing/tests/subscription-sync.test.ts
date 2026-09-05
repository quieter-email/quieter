import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import type * as DatabaseClientModule from "@quieter/database/client";
import type { billingSubscription } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { syncBillingSubscription } from "../src/subscription-sync";

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

vi.mock(import("@quieter/database/client"), async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseClientModule>();
  return {
    ...actual,
    db: Object.assign(actual.db, { insert: () => ({ values: mocks.values }) }),
  };
});

const subscriptionSchema = z.custom<Subscription>(
  (value) => typeof value === "object" && value !== null && "id" in value
);

const subscription = subscriptionSchema.parse({
  amount: 0,
  cancelAtPeriodEnd: false,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
  currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
  customerId: "customer-a",
  id: "subscription-a",
  metadata: {
    quieterOrganizationId: "team-a",
    quieterProduct: "managed",
    quieterUserId: "user-a",
  },
  modifiedAt: new Date("2026-09-01T00:00:00.000Z"),
  product: { metadata: {} },
  productId: "product-a",
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
        currentPeriodEnd: subscription.currentPeriodEnd,
        currentPeriodStart: subscription.currentPeriodStart,
        status: "active",
      })
    );
  });

  test("stores scheduled cancellation without ending access early", async () => {
    await syncBillingSubscription({ ...subscription, cancelAtPeriodEnd: true });
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
    await syncBillingSubscription({ ...subscription, modifiedAt: null });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ providerModifiedAt: subscription.createdAt })
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
