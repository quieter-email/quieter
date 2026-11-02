import type { models } from "@polar-sh/sdk/2026-04";
import { db } from "@quieter/database/client";
import {
  billingAccountSettings,
  billingSubscription,
  organization,
  user,
} from "@quieter/database/schema";
import type { BillingSubscriptionStatus } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { BILLING_PRODUCTS, billingProductIdSchema } from "./plans.ts";

export const BILLING_METADATA_PRODUCT = "quieterProduct";
export const BILLING_METADATA_USER_ID = "quieterUserId";
export const BILLING_METADATA_ORGANIZATION_ID = "quieterOrganizationId";
export const BILLING_METADATA_SCOPE = "quieterScope";
const BILLING_METADATA_LEGACY_PLAN = "quieterPlan";
const BILLING_PROVIDER = "polar" as const;
const excludedBillingSubscription = alias(billingSubscription, "excluded");
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
> & {
  checkout_id?: string | null;
  product: Pick<models.Subscription["product"], "metadata">;
};

export const billingPolarSubscriptionSchema = z.object({
  cancel_at_period_end: z.boolean(),
  checkout_id: z.string().nullable().optional(),
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

  const scope =
    subscription.metadata[BILLING_METADATA_SCOPE] === "account"
      ? ("account" as const)
      : ("team" as const);

  if (organizationId === null && scope === "team") {
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
    organizationId:
      scope === "account"
        ? null
        : sql`(select ${organization.id} from ${organization} where ${organization.id} = ${organizationId})`,
    plan: product,
    provider: BILLING_PROVIDER,
    providerCustomerId: subscription.customer_id,
    providerModifiedAt,
    providerProductId: subscription.product_id,
    providerSubscriptionId: subscription.id,
    scope,
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
        isNull(billingSubscription.providerModifiedAt),
        gte(
          excludedBillingSubscription.providerModifiedAt,
          billingSubscription.providerModifiedAt
        )
      ),
      target: [
        billingSubscription.provider,
        billingSubscription.providerSubscriptionId,
      ],
    });

  if (
    scope === "account" &&
    (values.status === "active" || values.status === "trialing")
  ) {
    await db.transaction(async (transaction) => {
      await transaction
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("update");
      const [synced] = await transaction
        .select({ id: billingSubscription.id })
        .from(billingSubscription)
        .where(
          and(
            eq(billingSubscription.providerSubscriptionId, subscription.id),
            eq(billingSubscription.userId, userId),
            eq(billingSubscription.scope, "account"),
            inArray(billingSubscription.status, ["active", "trialing"])
          )
        )
        .for("update");
      if (synced === undefined) {
        return;
      }
      const [settings] = await transaction
        .select()
        .from(billingAccountSettings)
        .where(eq(billingAccountSettings.userId, userId))
        .for("update");
      if (
        settings !== undefined &&
        ((settings.selectedSubscriptionId !== null &&
          settings.selectedSubscriptionId !== synced.id) ||
          (settings.checkoutAttemptId !== null &&
            (settings.checkoutId === null ||
              settings.checkoutId !== subscription.checkout_id)))
      ) {
        return;
      }
      await transaction
        .insert(billingAccountSettings)
        .values({
          activatedAt: now,
          selectedSubscriptionId: synced.id,
          updatedAt: now,
          userId,
        })
        .onConflictDoUpdate({
          set: {
            activatedAt: sql`coalesce(${billingAccountSettings.activatedAt}, ${now.toISOString()}::timestamp)`,
            checkoutAttemptId: null,
            checkoutExpiresAt: null,
            checkoutId: null,
            checkoutProduct: null,
            checkoutUrl: null,
            selectedSubscriptionId: sql`coalesce(${billingAccountSettings.selectedSubscriptionId}, ${synced.id})`,
            updatedAt: now,
          },
          target: billingAccountSettings.userId,
        });
    });
  }

  return { synced: true };
};
