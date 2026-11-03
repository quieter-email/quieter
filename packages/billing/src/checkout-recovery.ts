import { ORPCError } from "@orpc/server";
import { PolarClientError } from "@polar-sh/sdk";
import type { models } from "@polar-sh/sdk/2026-04";
import { db } from "@quieter/database/client";
import { billingAccountSettings, user } from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

import { getBillingExternalIdentity } from "./polar-config.ts";
import { getPolarClient } from "./polar.ts";
import {
  BILLING_METADATA_PRODUCT,
  BILLING_METADATA_SCOPE,
  BILLING_METADATA_USER_ID,
  syncBillingSubscription,
} from "./subscription-sync.ts";

export const BILLING_CHECKOUT_ATTEMPT_METADATA = "quieterCheckoutAttemptId";
export const BILLING_CHECKOUT_CLAIM_MS = 30 * 60 * 1000;

type CheckoutClaim = typeof billingAccountSettings.$inferSelect;
export type BillingCheckoutRecovery =
  | { status: "none" | "completed" }
  | { status: "pending"; expiresAt: Date | null }
  | {
      status: "open";
      checkoutUrl: string;
      expiresAt: Date;
      product: CheckoutClaim["checkoutProduct"];
    };

const reconciliationError = () =>
  new ORPCError("SERVICE_UNAVAILABLE", {
    message:
      "We could not verify your previous checkout. Please try again before starting another subscription.",
  });

const updateClaim = async (
  claim: CheckoutClaim,
  values: Partial<
    Pick<
      CheckoutClaim,
      | "checkoutAttemptId"
      | "checkoutExpiresAt"
      | "checkoutId"
      | "checkoutProduct"
      | "checkoutProviderProductId"
      | "checkoutUrl"
    >
  >
) =>
  await db.transaction(async (transaction) => {
    await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, claim.userId))
      .for("update");
    const [current] = await transaction
      .select()
      .from(billingAccountSettings)
      .where(eq(billingAccountSettings.userId, claim.userId))
      .limit(1);
    if (current?.checkoutAttemptId !== claim.checkoutAttemptId) {
      return false;
    }
    await transaction
      .update(billingAccountSettings)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(billingAccountSettings.userId, claim.userId),
          eq(
            billingAccountSettings.checkoutAttemptId,
            claim.checkoutAttemptId ?? ""
          )
        )
      );
    return true;
  });

const clearClaim = async (claim: CheckoutClaim) =>
  await updateClaim(claim, {
    checkoutAttemptId: null,
    checkoutExpiresAt: null,
    checkoutId: null,
    checkoutProduct: null,
    checkoutProviderProductId: null,
    checkoutUrl: null,
  });

const resolveCheckoutSubscription = async (
  checkout: models.Checkout,
  userId: string
) => {
  const polar = await getPolarClient();
  let subscription: models.Subscription | undefined;
  if (checkout.subscription_id) {
    subscription = await polar.subscriptions.get(checkout.subscription_id, {
      timeout: 10,
    });
  } else if (checkout.customer_id && checkout.product_id) {
    const deadline = Date.now() + 20_000;
    for (let page = 1; page <= 100; page += 1) {
      if (Date.now() >= deadline) {
        throw reconciliationError();
      }
      const result = await polar.subscriptions.list(
        {
          customer_id: checkout.customer_id,
          limit: 100,
          page,
          product_id: checkout.product_id,
        },
        { timeout: Math.min(10, (deadline - Date.now()) / 1000) }
      );
      for (const candidate of result.items) {
        if (
          candidate.metadata[BILLING_METADATA_USER_ID] === userId &&
          candidate.metadata[BILLING_METADATA_SCOPE] === "account" &&
          candidate.metadata[BILLING_CHECKOUT_ATTEMPT_METADATA] ===
            checkout.metadata[BILLING_CHECKOUT_ATTEMPT_METADATA]
        ) {
          if (subscription !== undefined) {
            throw reconciliationError();
          }
          subscription = candidate;
        }
      }
      if (page >= result.pagination.max_page) {
        break;
      }
      if (page === 100) {
        throw reconciliationError();
      }
    }
  }
  if (
    subscription === undefined ||
    subscription.metadata[BILLING_METADATA_USER_ID] !== userId ||
    subscription.metadata[BILLING_METADATA_SCOPE] !== "account" ||
    subscription.customer_id !== checkout.customer_id ||
    subscription.product_id !== checkout.product_id
  ) {
    throw reconciliationError();
  }
  const result = await syncBillingSubscription(subscription);
  if (!result.synced || ("ignored" in result && result.ignored === true)) {
    throw reconciliationError();
  }
  return result;
};

export const syncRecoveredBillingCheckout = async (input: {
  checkoutId: string;
  userId: string;
}) => {
  const polar = await getPolarClient();
  const checkout = await polar.checkouts.get(input.checkoutId, { timeout: 10 });
  if (
    checkout.status !== "succeeded" ||
    checkout.metadata[BILLING_METADATA_USER_ID] !== input.userId ||
    checkout.metadata[BILLING_METADATA_SCOPE] !== "account" ||
    checkout.external_customer_id !==
      getBillingExternalIdentity("user", input.userId)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This checkout cannot be applied to your billing account.",
    });
  }
  return await resolveCheckoutSubscription(checkout, input.userId);
};

export const recoverBillingCheckout = async (input: {
  userId: string;
}): Promise<BillingCheckoutRecovery> => {
  const [claim] = await db
    .select()
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, input.userId))
    .limit(1);
  if (!claim?.checkoutAttemptId) {
    return { status: "none" };
  }
  if (
    claim.checkoutId === null &&
    claim.checkoutExpiresAt !== null &&
    claim.checkoutExpiresAt > new Date()
  ) {
    return { expiresAt: claim.checkoutExpiresAt, status: "pending" };
  }
  const polar = await getPolarClient();
  const externalCustomerId = getBillingExternalIdentity("user", input.userId);
  let checkout: models.Checkout | undefined;
  if (claim.checkoutId !== null) {
    checkout = await polar.checkouts
      .get(claim.checkoutId, { timeout: 10 })
      .catch((error: unknown): undefined => {
        if (error instanceof PolarClientError && error.statusCode === 404) {
          return;
        }
        throw error;
      });
  }
  const deadline = Date.now() + 20_000;
  if (checkout === undefined) {
    for (let page = 1; page <= 100; page += 1) {
      if (Date.now() >= deadline) {
        throw reconciliationError();
      }
      const result = await polar.checkouts.list(
        { external_customer_id: externalCustomerId, limit: 100, page },
        { timeout: Math.min(10, (deadline - Date.now()) / 1000) }
      );
      for (const candidate of result.items) {
        if (
          candidate.metadata[BILLING_CHECKOUT_ATTEMPT_METADATA] ===
          claim.checkoutAttemptId
        ) {
          if (checkout !== undefined) {
            throw reconciliationError();
          }
          checkout = candidate;
        } else if (
          candidate.metadata[BILLING_CHECKOUT_ATTEMPT_METADATA] === undefined &&
          candidate.metadata[BILLING_METADATA_USER_ID] === input.userId &&
          candidate.metadata[BILLING_METADATA_SCOPE] === "account" &&
          (candidate.status === "open" || candidate.status === "confirmed")
        ) {
          // Untagged sessions from before crash recovery must also stop a replacement.
          throw reconciliationError();
        }
      }
      if (page >= result.pagination.max_page) {
        break;
      }
      if (page === 100) {
        throw reconciliationError();
      }
    }
  }
  if (checkout !== undefined) {
    const providerProductId = claim.checkoutProviderProductId;
    if (
      checkout.external_customer_id !== externalCustomerId ||
      checkout.metadata[BILLING_METADATA_USER_ID] !== input.userId ||
      checkout.metadata[BILLING_METADATA_SCOPE] !== "account" ||
      checkout.metadata[BILLING_METADATA_PRODUCT] !== claim.checkoutProduct ||
      (checkout.metadata[BILLING_CHECKOUT_ATTEMPT_METADATA] !==
        claim.checkoutAttemptId &&
        checkout.id !== claim.checkoutId) ||
      (providerProductId !== null && providerProductId !== checkout.product_id)
    ) {
      throw reconciliationError();
    }
    if (checkout.status === "succeeded") {
      if (
        !(await updateClaim(claim, {
          checkoutExpiresAt: new Date(checkout.expires_at),
          checkoutId: checkout.id,
          checkoutUrl: checkout.url,
        }))
      ) {
        return { expiresAt: null, status: "pending" };
      }
      await resolveCheckoutSubscription(checkout, input.userId);
      await clearClaim(claim);
      return { status: "completed" };
    }
    if (checkout.status === "confirmed") {
      const expiresAt = new Date(checkout.expires_at);
      if (!Number.isFinite(expiresAt.getTime())) {
        throw reconciliationError();
      }
      const updated = await updateClaim(claim, {
        checkoutExpiresAt: expiresAt,
        checkoutId: checkout.id,
        checkoutUrl: checkout.url,
      });
      return { expiresAt: updated ? expiresAt : null, status: "pending" };
    }
    if (checkout.status === "open") {
      const expiresAt = new Date(checkout.expires_at);
      if (!Number.isFinite(expiresAt.getTime())) {
        throw reconciliationError();
      }
      const updated = await updateClaim(claim, {
        checkoutExpiresAt: expiresAt,
        checkoutId: checkout.id,
        checkoutUrl: checkout.url,
      });
      return updated
        ? {
            checkoutUrl: checkout.url,
            expiresAt,
            product: claim.checkoutProduct,
            status: "open",
          }
        : { expiresAt: null, status: "pending" };
    }
    if (checkout.status !== "expired" && checkout.status !== "failed") {
      throw reconciliationError();
    }
  }
  // A missing or terminal checkout is insufficient proof that no subscription was created.
  for (let page = 1; page <= 100; page += 1) {
    if (Date.now() >= deadline) {
      throw reconciliationError();
    }
    const result = await polar.subscriptions.list(
      { external_customer_id: externalCustomerId, limit: 100, page },
      { timeout: Math.min(10, (deadline - Date.now()) / 1000) }
    );
    for (const subscription of result.items) {
      if (
        subscription.status !== "canceled" &&
        subscription.status !== "incomplete_expired"
      ) {
        if (
          subscription.metadata[BILLING_METADATA_USER_ID] !== input.userId ||
          subscription.metadata[BILLING_METADATA_SCOPE] !== "account"
        ) {
          throw reconciliationError();
        }
        const synced = await syncBillingSubscription(subscription);
        if (
          !synced.synced ||
          ("ignored" in synced && synced.ignored === true)
        ) {
          throw reconciliationError();
        }
        return { status: "completed" };
      }
    }
    if (page >= result.pagination.max_page) {
      break;
    }
    if (page === 100) {
      throw reconciliationError();
    }
  }
  return (await clearClaim(claim))
    ? { status: "none" }
    : { expiresAt: null, status: "pending" };
};
