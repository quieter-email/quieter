import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import { db } from "@quieter/database/client";
import { billingSubscription } from "@quieter/database/schema";
import type { BillingSubscriptionStatus } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { gte, or, sql } from "drizzle-orm";

import { BILLING_PRODUCTS, billingProductIdSchema } from "./plans.ts";

export const BILLING_METADATA_PRODUCT = "quieterProduct";
export const BILLING_METADATA_USER_ID = "quieterUserId";
export const BILLING_METADATA_ORGANIZATION_ID = "quieterOrganizationId";
const BILLING_METADATA_LEGACY_PLAN = "quieterPlan";
const BILLING_PROVIDER = "polar" as const;

const getSyncedBillingProduct = (subscription: Subscription) => {
  if (serverEnv.POLAR_PRODUCT_MANAGED_ID === subscription.productId) {
    return "managed";
  }
  if (serverEnv.POLAR_PRODUCT_PRO_ID === subscription.productId) {
    return "pro";
  }

  const providerProductMetadata =
    subscription.product.metadata[BILLING_METADATA_PRODUCT];
  if (typeof providerProductMetadata === "string") {
    for (const [productId, product] of Object.entries(BILLING_PRODUCTS)) {
      if (product.polarMetadataKey === providerProductMetadata) {
        const parsedProduct = billingProductIdSchema.safeParse(productId);
        if (parsedProduct.success) {
          return parsedProduct.data;
        }
      }
    }
  }

  const metadataProduct = billingProductIdSchema.safeParse(
    subscription.metadata?.[BILLING_METADATA_PRODUCT]
  );
  if (metadataProduct.success) {
    return metadataProduct.data;
  }

  const legacyPlan = subscription.metadata?.[BILLING_METADATA_LEGACY_PLAN];
  return legacyPlan === "managed" || legacyPlan === "pro" ? legacyPlan : null;
};

export const normalizeSubscriptionStatus = (
  status: Subscription["status"]
): BillingSubscriptionStatus => {
  switch (status) {
    case "active": {
      return "active";
    }
    case "canceled": {
      return "canceled";
    }
    case "past_due": {
      return "past_due";
    }
    case "trialing": {
      return "trialing";
    }
    case "incomplete": {
      return "pending";
    }
    case "incomplete_expired": {
      return "expired";
    }
    case "unpaid": {
      return "expired";
    }
    case "paused": {
      return "past_due";
    }
    default: {
      return "past_due";
    }
  }
};

export const syncBillingSubscription = async (subscription: Subscription) => {
  const environment = subscription.metadata.quieterEnvironment;
  if (
    (serverEnv.QUIETER_DEPLOYMENT_ENV === "local" && environment !== "local") ||
    (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local" && environment === "local")
  ) {
    return { ignored: true, synced: true };
  }
  const metadataUserId = subscription.metadata[BILLING_METADATA_USER_ID];
  const userId =
    typeof metadataUserId === "string" ? metadataUserId.trim() : "";
  const product = getSyncedBillingProduct(subscription);

  if ((userId ?? "") === "" || product === null) {
    reportError(new Error("Billing subscription metadata is incomplete."), {
      operation: "billing:sync-subscription",
      reason: "missing-user-or-product",
    });
    return { synced: false };
  }

  const metadataOrganizationId =
    subscription.metadata[BILLING_METADATA_ORGANIZATION_ID];
  const organizationId =
    typeof metadataOrganizationId === "string"
      ? metadataOrganizationId.trim() || null
      : null;

  if (typeof organizationId !== "string" || organizationId === "") {
    reportError(new Error("Billing subscription organization is missing."), {
      operation: "billing:sync-subscription",
      reason: "missing-organization",
    });
    return { synced: false };
  }

  const resolvedOrganizationId = organizationId;
  const now = new Date();
  const providerModifiedAt = new Date(
    subscription.modifiedAt ?? subscription.createdAt
  );

  const values = {
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
    currentPeriodStart: subscription.currentPeriodStart,
    lastReconciliationFailureAt: null,
    metadata: Object.fromEntries(
      Object.entries(subscription.metadata).map(([key, value]) => [
        key,
        String(value),
      ])
    ),
    organizationId: resolvedOrganizationId,
    plan: product,
    provider: BILLING_PROVIDER,
    providerCustomerId: subscription.customerId,
    providerModifiedAt,
    providerProductId: subscription.productId,
    providerSubscriptionId: subscription.id,
    status: normalizeSubscriptionStatus(subscription.status),
    updatedAt: now,
    userId,
  };

  await db
    .insert(billingSubscription)
    .values({
      ...values,
      createdAt: now,
      id: crypto.randomUUID(),
    })
    .onConflictDoUpdate({
      set: values,
      setWhere: or(
        sql`${billingSubscription.providerModifiedAt} IS NULL`,
        gte(
          sql`excluded."providerModifiedAt"`,
          billingSubscription.providerModifiedAt
        )
      ),
      target: [
        billingSubscription.provider,
        billingSubscription.providerSubscriptionId,
      ],
    });

  return { synced: true };
};
