import { ORPCError } from "@orpc/server";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import { db } from "@quieter/database/client";
import { mailbox, member, organization } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { eq } from "drizzle-orm";

import { getAiUsageCostMicroCents } from "./ai-pricing.ts";
import { getBillingCreditUsage, recordBillingCreditUsage } from "./credits.ts";
import type { BillingUsageKind } from "./credits.ts";
import {
  getOrganizationBillingEntitlement,
  getOrganizationSubscriptionRecord,
  hasUserBillingFeature,
  isActiveBillingSubscription,
  isLocalDevelopmentBillingEntitlementEnabled,
} from "./entitlements.ts";
import type { BillingProductId } from "./plans.ts";
import { getPolarApiOrganizationId, getPolarClient } from "./polar.ts";
import {
  BILLING_METADATA_ORGANIZATION_ID,
  BILLING_METADATA_PRODUCT,
  BILLING_METADATA_USER_ID,
  syncBillingSubscription,
} from "./subscription-sync.ts";

export {
  AI_COST_RECOVERY_BASIS_POINTS,
  applyAiCostRecoveryFee,
  getAiUsageCostMicroCents,
} from "./ai-pricing.ts";

export { syncBillingSubscription } from "./subscription-sync.ts";

export const createBillingCheckoutMetadata = (input: {
  organizationId: string;
  product: BillingProductId;
  userId: string;
}) => ({
  customerMetadata: {
    [BILLING_METADATA_ORGANIZATION_ID]: input.organizationId,
    [BILLING_METADATA_USER_ID]: input.userId,
  },
  metadata: {
    [BILLING_METADATA_ORGANIZATION_ID]: input.organizationId,
    [BILLING_METADATA_PRODUCT]: input.product,
    [BILLING_METADATA_USER_ID]: input.userId,
  },
});

export const createBillingPortalSession = (input: {
  organizationId: string;
  returnUrl: string;
  userId: string;
}) => ({
  externalCustomerId: `organization:${input.organizationId}`,
  externalMemberId: input.userId,
  returnUrl: input.returnUrl,
});

const getBillingProductId = (productId: BillingProductId): string => {
  const polarProductId = {
    managed: serverEnv.POLAR_PRODUCT_MANAGED_ID,
    pro: serverEnv.POLAR_PRODUCT_PRO_ID,
  }[productId];

  if (typeof polarProductId !== "string" || polarProductId === "") {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `Polar product is not configured for ${productId}.`,
    });
  }

  return polarProductId;
};

export const syncPolarCatalog = (): Record<BillingProductId, string> => ({
  managed: getBillingProductId("managed"),
  pro: getBillingProductId("pro"),
});

const getBaseUrl = (headers: Headers) => {
  const configured = serverEnv.BETTER_AUTH_URL ?? "";
  if (configured !== "") {
    return configured.replace(/\/$/u, "");
  }

  const origin = headers.get("origin")?.trim() ?? "";
  if (origin !== "") {
    return origin.replace(/\/$/u, "");
  }

  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "";
  const proto = headers.get("x-forwarded-proto") ?? "http";

  if (host === "") {
    return "http://localhost:3000";
  }

  return `${proto}://${host}`;
};

const getSettingsUrl = (
  headers: Headers,
  input: {
    billing?: "canceled" | "success";
    organizationId: string;
  }
) => {
  const url = new URL("/settings", getBaseUrl(headers));
  url.searchParams.set("tab", "organization");
  url.searchParams.set("organizationId", input.organizationId);
  url.searchParams.set("organizationView", "overview");

  if (input.billing) {
    url.searchParams.set("billing", input.billing);
  }
  return url.toString();
};

const withCheckoutIdPlaceholder = (url: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}checkoutId={CHECKOUT_ID}`;
};

export const createBillingCheckout = async (input: {
  customerEmail: string;
  customerName: string;
  headers: Headers;
  organizationId: string;
  product: BillingProductId;
  userId: string;
}) => {
  const successUrl = getSettingsUrl(input.headers, {
    billing: "success",
    organizationId: input.organizationId,
  });
  const cancelUrl = getSettingsUrl(input.headers, {
    billing: "canceled",
    organizationId: input.organizationId,
  });
  const [organizationRecord] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1);

  if (organizationRecord === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "Team not found.",
    });
  }
  const customerName = organizationRecord.name;

  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return {
      checkoutUrl: getSettingsUrl(input.headers, {
        billing: "success",
        organizationId: input.organizationId,
      }),
    };
  }

  const providerProductId = getBillingProductId(input.product);
  const subscription = await getOrganizationSubscriptionRecord(
    input.organizationId,
    { forceReconcile: true }
  );
  const activeSubscription =
    subscription !== null && isActiveBillingSubscription(subscription)
      ? subscription
      : null;

  if (
    subscription !== null &&
    activeSubscription === null &&
    subscription.status !== "canceled" &&
    subscription.status !== "expired"
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Your existing subscription needs attention. Open Manage billing before starting another subscription.",
    });
  }

  if (activeSubscription) {
    if (activeSubscription.plan !== input.product) {
      if (
        activeSubscription.cancelAtPeriodEnd ||
        activeSubscription.status === "trialing"
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "Open Manage billing to update your subscription before changing plans.",
        });
      }
      const polarClient = await getPolarClient();
      const updatedSubscription = await polarClient.subscriptions.update({
        id: activeSubscription.providerSubscriptionId,
        subscriptionUpdate: {
          productId: providerProductId,
          prorationBehavior: "invoice",
        },
      });
      await syncBillingSubscription(updatedSubscription);
    }

    return { checkoutUrl: successUrl };
  }

  const checkoutMetadata = createBillingCheckoutMetadata({
    organizationId: input.organizationId,
    product: input.product,
    userId: input.userId,
  });
  const polar = await getPolarClient();
  const externalCustomerId = `organization:${input.organizationId}`;
  let teamCustomerId: string | undefined;

  try {
    const externalCustomer = await polar.customers.getExternal({
      externalId: externalCustomerId,
    });
    teamCustomerId = externalCustomer.id;
  } catch (error) {
    // Resolved from the module cache: the call above already loaded the SDK.
    const { ResourceNotFound } =
      await import("@polar-sh/sdk/models/errors/resourcenotfound.js");
    if (!(error instanceof ResourceNotFound)) {
      throw error;
    }

    const createdCustomer = await polar.customers.create({
      externalId: externalCustomerId,
      metadata: checkoutMetadata.customerMetadata,
      name: customerName,
      organizationId: getPolarApiOrganizationId(),
      owner: {
        email: input.customerEmail,
        externalId: input.userId,
        name: input.customerName,
      },
      type: "team",
    });
    teamCustomerId = createdCustomer.id;
  }

  const checkout = await polar.checkouts.create({
    allowDiscountCodes: true,
    customerId: teamCustomerId,
    metadata: checkoutMetadata.metadata,
    products: [providerProductId],
    returnUrl: cancelUrl,
    successUrl: withCheckoutIdPlaceholder(successUrl),
  });

  return { checkoutUrl: checkout.url };
};

export const createBillingPortal = async (input: {
  headers: Headers;
  organizationId: string;
  userId: string;
}) => {
  const returnUrl = getSettingsUrl(input.headers, {
    organizationId: input.organizationId,
  });

  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return { portalUrl: returnUrl };
  }

  const portalClient = await getPolarClient();
  const session = await portalClient.customerSessions.create(
    createBillingPortalSession({
      organizationId: input.organizationId,
      returnUrl,
      userId: input.userId,
    })
  );

  return { portalUrl: session.customerPortalUrl };
};

const serializeEntitlement = async (
  entitlement: Awaited<ReturnType<typeof getOrganizationBillingEntitlement>>
) => {
  const usage = entitlement.account
    ? await getBillingCreditUsage(entitlement.account)
    : null;

  return {
    creditAmountCents: entitlement.account?.creditAmountCents ?? null,
    currentPeriodEnd: entitlement.account?.currentPeriodEnd ?? null,
    currentPeriodStart: entitlement.account?.currentPeriodStart ?? null,
    hasAccess: entitlement.hasAccess,
    hasUnlimitedAccess: entitlement.hasUnlimitedAccess,
    product: entitlement.product,
    usage: usage
      ? {
          billableCostCents: usage.billableCostMicroCents / 1_000_000,
          breakdown: usage.breakdown.map((item) => ({
            costCents: item.costMicroCents / 1_000_000,
            kind: item.kind,
          })),
          costCents: usage.costMicroCents / 1_000_000,
          remainingCreditCents:
            Math.max(0, usage.creditAmountMicroCents - usage.costMicroCents) /
            1_000_000,
        }
      : null,
  };
};

export const getBillingOverview = async (input: { userId: string }) => {
  const memberships = await db
    .select({
      organizationId: organization.id,
      organizationName: organization.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, input.userId))
    .orderBy(organization.name);
  const teams = await Promise.all(
    memberships.map(async (membership) => {
      const subscription = isLocalDevelopmentBillingEntitlementEnabled()
        ? null
        : await getOrganizationSubscriptionRecord(membership.organizationId);
      return {
        canManageBilling: membership.role
          .split(",")
          .map((role) => role.trim().toLowerCase())
          .some((role) => role === "admin" || role === "owner"),
        organizationId: membership.organizationId,
        organizationName: membership.organizationName,
        ...(await serializeEntitlement(
          await getOrganizationBillingEntitlement({
            feature: "organizationMail",
            organizationId: membership.organizationId,
            subscription,
          })
        )),
        subscription:
          subscription === null
            ? null
            : {
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                currentPeriodEnd: subscription.currentPeriodEnd,
                status: subscription.status,
              },
      };
    })
  );

  return { teams };
};

export const syncBillingCheckout = async (input: {
  checkoutId: string;
  userId: string;
}) => {
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return { synced: false };
  }

  const polar = await getPolarClient();
  const checkout = await polar.checkouts.get({ id: input.checkoutId });
  const checkoutUserId = checkout.metadata[BILLING_METADATA_USER_ID];

  if (checkout.status !== "succeeded" || checkoutUserId !== input.userId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This checkout cannot be applied to your billing account.",
    });
  }

  let subscription: Subscription | undefined;
  if ((checkout.subscriptionId ?? "") !== "") {
    const { subscriptionId } = checkout;
    if (typeof subscriptionId !== "string") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This checkout cannot be applied to your billing account.",
      });
    }
    subscription = await polar.subscriptions.get({
      id: subscriptionId,
    });
  } else if (
    (checkout.customerId ?? "") !== "" &&
    (checkout.productId ?? "") !== ""
  ) {
    const subscriptions = await polar.subscriptions.list({
      customerId: checkout.customerId,
      limit: 10,
      productId: checkout.productId,
      sorting: ["-started_at"],
      status: ["active", "trialing"],
    });
    subscription = subscriptions.result.items.find(
      (candidate) =>
        candidate.metadata[BILLING_METADATA_USER_ID] === input.userId
    );
  }

  if (subscription === undefined) {
    reportError(
      new Error(
        "Could not resolve the subscription created by a completed checkout."
      ),
      { operation: "billing:resolve-checkout-subscription" }
    );
    throw new ORPCError("BAD_REQUEST", {
      message: "We could not activate your plan. Please contact support.",
    });
  }

  return await syncBillingSubscription(subscription);
};

const recordAiCreditUsage = async (input: {
  chatId?: string | null;
  costMicroCents: number;
  externalId: string;
  mailboxId?: string;
  metadata: Record<string, number | string>;
  userId: string;
}) => {
  const mailboxId = input.mailboxId ?? "";
  if (mailboxId === "") {
    return;
  }
  const [mailboxRow] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .limit(1);
  if (mailboxRow === undefined) {
    return;
  }

  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: mailboxRow.organizationId,
    userId: input.userId,
  });
  if (entitlement.account === null) {
    return;
  }

  await recordBillingCreditUsage({
    account: entitlement.account,
    category: "ai",
    costMicroCents: input.costMicroCents,
    dedupeKey: `ai:${input.externalId}`,
    metadata: {
      chatId: input.chatId ?? "",
      ...input.metadata,
    },
  });
};

export const reportAiUsage = async (input: {
  chatId?: string | null;
  costUsd: number | undefined;
  completionTokens: number;
  externalId: string;
  mailboxId?: string;
  model: string;
  promptTokens: number;
  promptTokensDetails?: {
    cachedTokens?: number;
    cacheWriteTokens?: number;
  };
  usageKind: Extract<
    BillingUsageKind,
    "aiChat" | "aiMemory" | "autoLabel" | "usefulDetails"
  >;
  userId: string;
}) => {
  if (input.costUsd === undefined) {
    throw new Error("The AI provider did not report a generation cost.");
  }

  if (input.costUsd <= 0) {
    return;
  }

  const costMicroCents = getAiUsageCostMicroCents(input.costUsd);
  if (costMicroCents <= 0) {
    return;
  }

  await recordAiCreditUsage({
    chatId: input.chatId,
    costMicroCents,
    externalId: input.externalId,
    mailboxId: input.mailboxId,
    metadata: {
      cacheWriteTokens: input.promptTokensDetails?.cacheWriteTokens ?? 0,
      cachedTokens: input.promptTokensDetails?.cachedTokens ?? 0,
      completionTokens: input.completionTokens,
      costUsd: input.costUsd,
      model: input.model,
      promptTokens: input.promptTokens,
      usageKind: input.usageKind,
    },
    userId: input.userId,
  });
};
