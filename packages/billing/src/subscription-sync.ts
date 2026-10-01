import type { models } from "@polar-sh/sdk/2026-04";
import { db } from "@quieter/database/client";
import { billingSubscription } from "@quieter/database/schema";
import type { BillingSubscriptionStatus } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { gte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { BILLING_PRODUCTS, billingProductIdSchema } from "./plans.ts";

export const BILLING_METADATA_PRODUCT = "quieterProduct";
export const BILLING_METADATA_USER_ID = "quieterUserId";
export const BILLING_METADATA_ORGANIZATION_ID = "quieterOrganizationId";
const BILLING_METADATA_LEGACY_PLAN = "quieterPlan";
const BILLING_PROVIDER = "polar" as const;
export type BillingPolarSubscription = Pick<
  models.Subscription,
  | "cancel_at_period_end"
  | "created_at"
  | "current_period_end"
  | "current_period_start"
  | "customer_id"
  | "id"
  | "metadata"
  | "modified_at"
  | "product_id"
  | "status"
> & { product: Pick<models.Subscription["product"], "metadata"> };

export const billingPolarSubscriptionSchema = z.object({
  cancel_at_period_end: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  current_period_end: z.iso.datetime({ offset: true }),
  current_period_start: z.iso.datetime({ offset: true }),
  customer_id: z.string().min(1),
  id: z.string().min(1),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),
  modified_at: z.iso.datetime({ offset: true }).nullable(),
  product: z.object({
    metadata: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()])
    ),
  }),
  product_id: z.string().min(1),
  status: z.enum([
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ]),
}) satisfies z.ZodType<BillingPolarSubscription>;

const getSyncedBillingProduct = (subscription: BillingPolarSubscription) => {
  if (serverEnv.POLAR_PRODUCT_MANAGED_ID === subscription.product_id) {
    return "managed";
  }
  if (serverEnv.POLAR_PRODUCT_PRO_ID === subscription.product_id) {
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
  status: BillingPolarSubscription["status"]
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

export const syncBillingSubscription = async (
  subscription: BillingPolarSubscription
) => {
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

  if (userId === "" || product === null) {
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

  if (organizationId === null) {
    reportError(new Error("Billing subscription organization is missing."), {
      operation: "billing:sync-subscription",
      reason: "missing-organization",
    });
    return { synced: false };
  }

  const now = new Date();
  const providerModifiedAt = new Date(
    subscription.modified_at ?? subscription.created_at
  );

  const values = {
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: new Date(subscription.current_period_end),
    currentPeriodStart: new Date(subscription.current_period_start),
    lastReconciliationFailureAt: null,
    metadata: Object.fromEntries(
      Object.entries(subscription.metadata).map(([key, value]) => [
        key,
        String(value),
      ])
    ),
    organizationId,
    plan: product,
    provider: BILLING_PROVIDER,
    providerCustomerId: subscription.customer_id,
    providerModifiedAt,
    providerProductId: subscription.product_id,
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
