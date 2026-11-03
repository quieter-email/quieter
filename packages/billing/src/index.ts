import { ORPCError } from "@orpc/server";
import { PolarClientError } from "@polar-sh/sdk";
import { db } from "@quieter/database/client";
import {
  billingAccountSettings,
  billingSubscription,
  mailbox,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { getAccountUsageSettings } from "./account-settings.ts";
import { getAiUsageCostMicroCents } from "./ai-pricing.ts";
import { hasAiCreditReservationGroup } from "./ai-reservation.ts";
import {
  BILLING_CHECKOUT_ATTEMPT_METADATA,
  BILLING_CHECKOUT_CLAIM_MS,
  recoverBillingCheckout,
  syncRecoveredBillingCheckout,
} from "./checkout-recovery.ts";
import { getBillingCreditUsage, recordBillingCreditUsage } from "./credits.ts";
import type { BillingUsageKind } from "./credits.ts";
import {
  getOrganizationBillingEntitlement,
  getAccountBillingEntitlement,
  getAccountSubscriptionRecord,
  getOrganizationBillingOwnerId,
  getOrganizationSubscriptionRecord,
  hasUserBillingFeature,
  isActiveBillingSubscription,
  isLocalDevelopmentBillingEntitlementEnabled,
} from "./entitlements.ts";
import type { BillingProductId } from "./plans.ts";
import { getBillingExternalIdentity } from "./polar-config.ts";
import { getPolarClient } from "./polar.ts";
import { getManagedUsageRates } from "./ses-pricing.ts";
import {
  BILLING_METADATA_PRODUCT,
  BILLING_METADATA_SCOPE,
  BILLING_METADATA_USER_ID,
  syncBillingSubscription,
} from "./subscription-sync.ts";
import {
  getCalendarUsagePeriod,
  getRecordedUsageOverview,
} from "./usage-overview.ts";

export {
  AI_COST_RECOVERY_BASIS_POINTS,
  applyAiCostRecoveryFee,
  getAiUsageCostMicroCents,
} from "./ai-pricing.ts";

export { recoverBillingCheckout } from "./checkout-recovery.ts";
export { syncBillingSubscription } from "./subscription-sync.ts";
export {
  updateAccountUsageSettings,
  takeOverOrganizationBilling,
} from "./account-settings.ts";

export const createBillingCheckoutMetadata = (input: {
  organizationId?: string;
  product: BillingProductId;
  userId: string;
}) => ({
  customerMetadata: {
    quieterEnvironment: serverEnv.QUIETER_DEPLOYMENT_ENV,
    [BILLING_METADATA_SCOPE]: "account",
    [BILLING_METADATA_USER_ID]: input.userId,
  },
  metadata: {
    quieterEnvironment: serverEnv.QUIETER_DEPLOYMENT_ENV,
    [BILLING_METADATA_SCOPE]: "account",
    [BILLING_METADATA_PRODUCT]: input.product,
    [BILLING_METADATA_USER_ID]: input.userId,
  },
});

export const createBillingPortalSession = (input: {
  returnUrl: string;
  userId: string;
}) => ({
  externalCustomerId: getBillingExternalIdentity("user", input.userId),
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
    organizationId?: string;
  }
) => {
  const url = new URL("/settings", getBaseUrl(headers));
  url.searchParams.set("tab", "billing");

  if (input.billing) {
    url.searchParams.set("billing", input.billing);
  }
  return url.toString();
};

const withCheckoutIdPlaceholder = (url: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}checkoutId={CHECKOUT_ID}`;
};

const assertBillingOwner = async (input: {
  organizationId?: string;
  userId: string;
}) => {
  if (input.organizationId === undefined) {
    return;
  }
  const ownerId = await getOrganizationBillingOwnerId(input.organizationId);
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, input.userId),
        eq(member.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (ownerId !== input.userId || membership === undefined) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only this team's billing owner can manage the account plan.",
    });
  }
};

export const createBillingCheckout = async (input: {
  customerEmail: string;
  customerName: string;
  headers: Headers;
  organizationId?: string;
  product: BillingProductId;
  userId: string;
}) => {
  await assertBillingOwner(input);
  const successUrl = getSettingsUrl(input.headers, {
    billing: "success",
    organizationId: input.organizationId,
  });
  const cancelUrl = getSettingsUrl(input.headers, {
    billing: "canceled",
    organizationId: input.organizationId,
  });
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return {
      checkoutUrl: getSettingsUrl(input.headers, {
        billing: "success",
        organizationId: input.organizationId,
      }),
    };
  }

  await db.transaction(async (transaction) => {
    await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    const [settings] = await transaction
      .select()
      .from(billingAccountSettings)
      .where(eq(billingAccountSettings.userId, input.userId))
      .limit(1);
    if (
      settings?.deletionRequestedAt !== undefined &&
      settings.deletionRequestedAt !== null
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This billing account is closing.",
      });
    }
  });

  const providerProductId = getBillingProductId(input.product);
  const subscription = await getAccountSubscriptionRecord(input.userId, {
    forceReconcile: true,
  });
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
      const updatedSubscription = await polarClient.subscriptions.update(
        activeSubscription.providerSubscriptionId,
        {
          product_id: providerProductId,
          proration_behavior: "invoice",
        }
      );
      await syncBillingSubscription(updatedSubscription);
    }

    return { checkoutUrl: successUrl };
  }

  const recovery = await recoverBillingCheckout({ userId: input.userId });
  if (recovery.status === "completed") {
    return { checkoutUrl: successUrl };
  }
  if (recovery.status === "open" && recovery.product === input.product) {
    return { checkoutUrl: recovery.checkoutUrl };
  }
  if (recovery.status !== "none") {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message:
        "A checkout is already open for your account. Complete it or wait for it to expire before choosing another plan.",
    });
  }

  const attemptId = crypto.randomUUID();
  await db.transaction(async (transaction) => {
    await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    const [activated] = await transaction
      .select({ id: billingSubscription.id })
      .from(billingSubscription)
      .where(
        and(
          eq(billingSubscription.userId, input.userId),
          eq(billingSubscription.scope, "account"),
          inArray(billingSubscription.status, [
            "active",
            "trialing",
            "past_due",
            "pending",
          ])
        )
      )
      .limit(1);
    if (activated !== undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Your account already has a subscription. Reload billing to manage it.",
      });
    }
    const [settings] = await transaction
      .select()
      .from(billingAccountSettings)
      .where(eq(billingAccountSettings.userId, input.userId))
      .limit(1);
    if (
      settings?.deletionRequestedAt !== null &&
      settings?.deletionRequestedAt !== undefined
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This billing account is closing.",
      });
    }
    if (settings?.checkoutAttemptId) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message:
          "A checkout is already open for your account. Complete it or wait for it to expire before choosing another plan.",
      });
    }
    const claim = {
      checkoutAttemptId: attemptId,
      checkoutExpiresAt: new Date(Date.now() + BILLING_CHECKOUT_CLAIM_MS),
      checkoutId: null,
      checkoutProduct: input.product,
      checkoutProviderProductId: providerProductId,
      checkoutUrl: null,
      selectedSubscriptionId: null,
      updatedAt: new Date(),
    };
    await transaction
      .insert(billingAccountSettings)
      .values({ ...claim, userId: input.userId })
      .onConflictDoUpdate({
        set: claim,
        target: billingAccountSettings.userId,
      });
  });

  const checkoutMetadata = createBillingCheckoutMetadata({
    organizationId: input.organizationId,
    product: input.product,
    userId: input.userId,
  });
  const polar = await getPolarClient();
  const checkout = await polar.checkouts
    .create(
      {
        allow_discount_codes: true,
        customer_email: input.customerEmail,
        customer_metadata: checkoutMetadata.customerMetadata,
        customer_name: input.customerName,
        external_customer_id: getBillingExternalIdentity("user", input.userId),
        metadata: {
          ...checkoutMetadata.metadata,
          [BILLING_CHECKOUT_ATTEMPT_METADATA]: attemptId,
        },
        products: [providerProductId],
        return_url: cancelUrl,
        success_url: withCheckoutIdPlaceholder(successUrl),
      },
      { timeout: 15 }
    )
    .catch(async (error: unknown) => {
      if (
        error instanceof PolarClientError &&
        [400, 401, 403, 404, 422].includes(error.statusCode)
      ) {
        await db
          .update(billingAccountSettings)
          .set({
            checkoutAttemptId: null,
            checkoutExpiresAt: null,
            checkoutId: null,
            checkoutProduct: null,
            checkoutProviderProductId: null,
            checkoutUrl: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(billingAccountSettings.userId, input.userId),
              eq(billingAccountSettings.checkoutAttemptId, attemptId)
            )
          );
      }
      throw error;
    });

  const persisted = await db.transaction(async (transaction) => {
    await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    const [settings] = await transaction
      .select()
      .from(billingAccountSettings)
      .where(eq(billingAccountSettings.userId, input.userId))
      .limit(1);
    const [updated] = await transaction
      .update(billingAccountSettings)
      .set({
        checkoutExpiresAt: new Date(checkout.expires_at),
        checkoutId: checkout.id,
        checkoutUrl: checkout.url,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(billingAccountSettings.userId, input.userId),
          eq(billingAccountSettings.checkoutAttemptId, attemptId)
        )
      )
      .returning({ userId: billingAccountSettings.userId });
    return (
      updated !== undefined &&
      (settings?.deletionRequestedAt === undefined ||
        settings.deletionRequestedAt === null)
    );
  });
  if (!persisted) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This billing account changed while opening checkout. Reload billing before continuing.",
    });
  }

  return { checkoutUrl: checkout.url };
};

export const createBillingPortal = async (input: {
  headers: Headers;
  organizationId?: string;
  userId: string;
}) => {
  await assertBillingOwner(input);
  const returnUrl = getSettingsUrl(input.headers, {
    organizationId: input.organizationId,
  });

  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return { portalUrl: returnUrl };
  }

  const portalClient = await getPolarClient();
  const portalSession = createBillingPortalSession({
    returnUrl,
    userId: input.userId,
  });
  const session = await portalClient.customerSessions.create({
    external_customer_id: portalSession.externalCustomerId,
    return_url: portalSession.returnUrl,
  });

  return { portalUrl: session.customer_portal_url };
};

const serializeEntitlement = async (
  entitlement: Awaited<ReturnType<typeof getOrganizationBillingEntitlement>>,
  requesterUserId: string,
  organizationId?: string
) => {
  let period = entitlement.hasUnlimitedAccess ? getCalendarUsagePeriod() : null;
  let usage: Awaited<ReturnType<typeof getRecordedUsageOverview>> | null = null;
  if (entitlement.account) {
    period = {
      end: entitlement.account.currentPeriodEnd,
      start: entitlement.account.currentPeriodStart,
    };
    usage = await getBillingCreditUsage(entitlement.account);
  } else if (entitlement.hasUnlimitedAccess && period !== null) {
    usage = await getRecordedUsageOverview(
      organizationId === undefined
        ? { billingOwnerUserId: requesterUserId }
        : { organizationId },
      period
    );
  }
  const organizations =
    usage?.organizations.filter(
      (item) =>
        organizationId === undefined || item.organizationId === organizationId
    ) ?? [];
  const breakdown =
    organizationId === undefined
      ? (usage?.breakdown ?? [])
      : (organizations[0]?.breakdown ?? []);
  const costMicroCents =
    organizationId === undefined
      ? (usage?.costMicroCents ?? 0)
      : (organizations[0]?.costMicroCents ?? 0);

  return {
    creditAmountCents: entitlement.account?.creditAmountCents ?? null,
    currentPeriodEnd: period?.end ?? null,
    currentPeriodStart: period?.start ?? null,
    hasAccess: entitlement.hasAccess,
    hasUnlimitedAccess: entitlement.hasUnlimitedAccess,
    product: entitlement.product,
    usage: usage
      ? {
          billableCostCents:
            (organizationId === undefined
              ? usage.billableCostMicroCents
              : (organizations[0]?.billableCostMicroCents ?? 0)) / 1_000_000,
          breakdown: breakdown.map((item) => ({
            costCents: item.costMicroCents / 1_000_000,
            kind: item.kind,
          })),
          costCents: costMicroCents / 1_000_000,
          organizations: organizations.map((item) => ({
            breakdown: item.breakdown.map((entry) => ({
              costCents: entry.costMicroCents / 1_000_000,
              kind: entry.kind,
            })),
            costCents: item.costMicroCents / 1_000_000,
            organizationId: item.organizationId,
            organizationName: item.organizationName,
          })),
          remainingCreditCents:
            entitlement.account?.billingOwnerUserId === requesterUserId
              ? Math.max(
                  0,
                  entitlement.account.creditAmountCents * 1_000_000 -
                    usage.chargeableCostMicroCents
                ) / 1_000_000
              : null,
        }
      : null,
  };
};

export const getBillingOverview = async (input: { userId: string }) => {
  const memberships = await db
    .select({
      billingOwnerName: user.name,
      organizationId: organization.id,
      organizationName: organization.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(user, eq(user.id, organization.billingOwnerUserId))
    .where(eq(member.userId, input.userId))
    .orderBy(organization.name);
  const teams = await Promise.all(
    memberships.map(async (membership) => {
      const billingOwnerUserId = await getOrganizationBillingOwnerId(
        membership.organizationId
      );
      const isBillingOwner = billingOwnerUserId === input.userId;
      const entitlement = await getOrganizationBillingEntitlement({
        feature: "organizationMail",
        organizationId: membership.organizationId,
      });
      const subscription = entitlement.hasUnlimitedAccess
        ? null
        : await getOrganizationSubscriptionRecord(membership.organizationId);
      return {
        billingOwnerIsCurrentUser: isBillingOwner,
        billingOwnerName: membership.billingOwnerName ?? "The team owner",
        canManageBilling: isBillingOwner,
        canTakeOverBilling:
          membership.role.split(",").includes("owner") && !isBillingOwner,
        organizationId: membership.organizationId,
        organizationName: membership.organizationName,
        ...(await serializeEntitlement(
          entitlement,
          input.userId,
          membership.organizationId
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

  const entitlement = await getAccountBillingEntitlement(input.userId);
  const subscription = entitlement.hasUnlimitedAccess
    ? null
    : await getAccountSubscriptionRecord(input.userId);
  const settings = await getAccountUsageSettings(input.userId);
  const [management] = await db
    .select({
      checkoutId: billingAccountSettings.checkoutId,
      deletionRequestedAt: billingAccountSettings.deletionRequestedAt,
    })
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, input.userId))
    .limit(1);
  const [customer] = await db
    .select({ id: billingSubscription.id })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.userId, input.userId),
        eq(billingSubscription.scope, "account"),
        isNotNull(billingSubscription.providerCustomerId)
      )
    )
    .limit(1);
  const account = {
    ...(await serializeEntitlement(entitlement, input.userId)),
    canManageBilling: true,
    hasBillingCustomer:
      customer !== undefined || Boolean(management?.checkoutId),
    isClosing: Boolean(management?.deletionRequestedAt),
    managedUsageRates: getManagedUsageRates(),
    settings,
    subscription:
      subscription === null
        ? null
        : {
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            currentPeriodEnd: subscription.currentPeriodEnd,
            status: subscription.status,
          },
  };

  return { account, teams };
};

export const syncBillingCheckout = async (input: {
  checkoutId: string;
  userId: string;
}) => {
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return { synced: false };
  }

  return await syncRecoveredBillingCheckout(input);
};

const recordAiCreditUsage = async (input: {
  chatId?: string | null;
  costMicroCents: number;
  externalId: string;
  mailboxId?: string;
  metadata: Record<string, number | string>;
  userId: string;
}) => {
  // Retain reporting of pre-rollout usage. New provider requests settle their
  // own durable operations, including unlimited-account markers.
  if (await hasAiCreditReservationGroup(input.externalId)) {
    return;
  }
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
    | "importance"
    | "aiChat"
    | "aiMemory"
    | "mailAction"
    | "autoLabel"
    | "usefulDetails"
    | "verificationCode"
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
