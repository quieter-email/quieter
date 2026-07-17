import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import { db } from "@quieter/database/client";
import {
  billingSubscription,
  type BillingPlan as StoredBillingPlan,
  type BillingSubscriptionStatus,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import { BILLING_PRODUCTS, billingProductIdSchema, type BillingProductId } from "./plans";

export const BILLING_METADATA_PRODUCT = "quieterProduct";
export const BILLING_METADATA_USER_ID = "quieterUserId";
export const BILLING_METADATA_ORGANIZATION_ID = "quieterOrganizationId";
const BILLING_METADATA_LEGACY_PLAN = "quieterPlan";
const BILLING_PROVIDER = "polar" as const;

const getSyncedBillingProduct = (subscription: Subscription) => {
  const configuredProduct =
    serverEnv.POLAR_PRODUCT_MANAGED_ID === subscription.productId
      ? "managed"
      : serverEnv.POLAR_PRODUCT_PRO_ID === subscription.productId
        ? "pro"
        : null;
  if (configuredProduct) return configuredProduct;

  const providerProductMetadata = subscription.product.metadata[BILLING_METADATA_PRODUCT];
  if (typeof providerProductMetadata === "string") {
    for (const [productId, product] of Object.entries(BILLING_PRODUCTS)) {
      if (product.polarMetadataKey === providerProductMetadata) {
        return productId as BillingProductId;
      }
    }
  }

  const metadataProduct = billingProductIdSchema.safeParse(
    subscription.metadata?.[BILLING_METADATA_PRODUCT],
  );
  if (metadataProduct.success) return metadataProduct.data;

  const legacyPlan = subscription.metadata?.[BILLING_METADATA_LEGACY_PLAN];
  return legacyPlan === "managed" || legacyPlan === "pro" ? legacyPlan : null;
};

const normalizeSubscriptionStatus = (status: Subscription["status"]): BillingSubscriptionStatus => {
  switch (status) {
    case "active":
      return "active";
    case "canceled":
      return "canceled";
    case "past_due":
      return "past_due";
    case "trialing":
      return "trialing";
    case "incomplete":
      return "pending";
    case "incomplete_expired":
      return "expired";
    default:
      return "past_due";
  }
};

export const syncBillingSubscription = async (subscription: Subscription) => {
  const metadataUserId = subscription.metadata[BILLING_METADATA_USER_ID];
  const userId = typeof metadataUserId === "string" ? metadataUserId.trim() : "";
  const product = getSyncedBillingProduct(subscription);

  if (!userId || !product) {
    console.warn("Skipping billing subscription without Quieter metadata.", {
      productId: subscription.productId,
      subscriptionId: subscription.id,
    });
    return { synced: false };
  }

  const metadataOrganizationId = subscription.metadata[BILLING_METADATA_ORGANIZATION_ID];
  const organizationId =
    typeof metadataOrganizationId === "string" ? metadataOrganizationId.trim() || null : null;

  if (!organizationId) {
    console.warn("Skipping team subscription without a team.", {
      subscriptionId: subscription.id,
    });
    return { synced: false };
  }

  const now = new Date();
  const [existingSubscription] = await db
    .select({ id: billingSubscription.id })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.provider, BILLING_PROVIDER),
        eq(billingSubscription.providerSubscriptionId, subscription.id),
      ),
    )
    .limit(1);
  const values = {
    currentPeriodEnd: subscription.currentPeriodEnd,
    currentPeriodStart: subscription.currentPeriodStart,
    metadata: Object.fromEntries(
      Object.entries(subscription.metadata).map(([key, value]) => [key, String(value)]),
    ),
    organizationId,
    plan: product as StoredBillingPlan,
    provider: BILLING_PROVIDER,
    providerCustomerId: subscription.customerId,
    providerProductId: subscription.productId,
    providerSubscriptionId: subscription.id,
    status: normalizeSubscriptionStatus(subscription.status),
    updatedAt: now,
    userId,
  };

  if (existingSubscription) {
    await db
      .update(billingSubscription)
      .set(values)
      .where(eq(billingSubscription.id, existingSubscription.id));
  } else {
    await db.insert(billingSubscription).values({
      ...values,
      createdAt: now,
      id: crypto.randomUUID(),
    });
  }

  return { synced: true };
};
