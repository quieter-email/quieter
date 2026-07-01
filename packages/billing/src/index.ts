import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import type {
  BillingPlan as StoredBillingPlan,
  BillingSubscriptionStatus,
} from "@quieter/database/schema";
import { ORPCError } from "@orpc/server";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound.js";
import { db } from "@quieter/database/client";
import { billingSubscription, mailbox, member, organization } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getBillingCreditUsage, recordBillingCreditUsage, type BillingUsageKind } from "./credits";
import {
  getOrganizationBillingEntitlement,
  hasUserBillingFeature,
  isActiveBillingStatus,
  subscriptionBelongsToOrganization,
} from "./entitlements";
import {
  BILLING_PRODUCTS,
  BILLING_PRODUCT_IDS,
  billingProductIdSchema,
  type BillingProductId,
} from "./plans";
import { getPolarApiOrganizationId, getPolarClient } from "./polar";

const BILLING_PROVIDER = "polar" as const;
const BILLING_METADATA_PRODUCT = "quieterProduct";
const BILLING_METADATA_USER_ID = "quieterUserId";
const BILLING_METADATA_ORGANIZATION_ID = "quieterOrganizationId";
const BILLING_METADATA_LEGACY_PLAN = "quieterPlan";

export const createBillingCheckoutMetadata = (input: {
  organizationId: string;
  product: BillingProductId;
  userId: string;
}) => {
  return {
    customerMetadata: {
      [BILLING_METADATA_ORGANIZATION_ID]: input.organizationId,
      [BILLING_METADATA_USER_ID]: input.userId,
    },
    metadata: {
      [BILLING_METADATA_ORGANIZATION_ID]: input.organizationId,
      [BILLING_METADATA_PRODUCT]: input.product,
      [BILLING_METADATA_USER_ID]: input.userId,
    },
  };
};

export const createBillingPortalSession = (input: {
  organizationId: string;
  returnUrl: string;
  userId: string;
}) => ({
  externalCustomerId: `organization:${input.organizationId}`,
  externalMemberId: input.userId,
  returnUrl: input.returnUrl,
});

const aiUsageRates = {
  "anthropic/claude-haiku-4.5": { completion: 500, prompt: 100 },
  "deepseek/deepseek-v4-flash": { completion: 18, prompt: 9 },
  "google/gemini-3.1-flash-lite": { completion: 150, prompt: 25 },
  "google/gemini-3.5-flash": { completion: 900, prompt: 150 },
  "openai/gpt-5-nano": { completion: 40, prompt: 5 },
  "openai/gpt-5.4-mini": { completion: 450, prompt: 75 },
  "openai/gpt-5.4-nano": { completion: 125, prompt: 20 },
  "openai/gpt-5.5": { completion: 3_000, prompt: 500 },
} as const;

export const AI_USAGE_MARKUP_BASIS_POINTS = 5_000;

export const applyAiUsageMarkup = (costMicroCents: number) =>
  Math.ceil(costMicroCents * (1 + AI_USAGE_MARKUP_BASIS_POINTS / 10_000));

const getBillingProductId = (productId: BillingProductId): string => {
  const polarProductId = {
    managed: serverEnv.POLAR_PRODUCT_MANAGED_ID,
    pro: serverEnv.POLAR_PRODUCT_PRO_ID,
  }[productId];

  if (!polarProductId) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `Polar product is not configured for ${productId}.`,
    });
  }

  return polarProductId;
};

export const syncPolarCatalog = () => {
  const products = {} as Record<BillingProductId, string>;

  for (const product of BILLING_PRODUCT_IDS) {
    products[product] = getBillingProductId(product);
  }

  return products;
};

const getProductForProviderProductId = (providerProductId: string): BillingProductId | null => {
  if (serverEnv.POLAR_PRODUCT_MANAGED_ID === providerProductId) return "managed";
  if (serverEnv.POLAR_PRODUCT_PRO_ID === providerProductId) return "pro";
  return null;
};

const getProductForPolarMetadataKey = (metadataKey: string | undefined) => {
  if (!metadataKey) return null;

  for (const [productId, product] of Object.entries(BILLING_PRODUCTS)) {
    if (product.polarMetadataKey === metadataKey) {
      return productId as BillingProductId;
    }
  }

  return null;
};

const getBaseUrl = (headers: Headers) => {
  const configured = serverEnv.BETTER_AUTH_URL;
  if (configured) return configured.replace(/\/$/, "");

  const origin = headers.get("origin")?.trim();
  if (origin) return origin.replace(/\/$/, "");

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";

  return host ? `${proto}://${host}` : "http://localhost:3000";
};

const getSettingsUrl = (
  headers: Headers,
  input: {
    billing?: "canceled" | "success";
    organizationId: string;
  },
) => {
  const url = new URL("/settings", getBaseUrl(headers));
  url.searchParams.set("tab", "organization");
  url.searchParams.set("organizationId", input.organizationId);
  url.searchParams.set("organizationView", "overview");

  if (input.billing) url.searchParams.set("billing", input.billing);
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
  let successUrl = getSettingsUrl(input.headers, {
    billing: "success",
    organizationId: input.organizationId,
  });
  const cancelUrl = getSettingsUrl(input.headers, {
    billing: "canceled",
    organizationId: input.organizationId,
  });
  successUrl = withCheckoutIdPlaceholder(successUrl);
  const [organizationRecord] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1);

  if (!organizationRecord) {
    throw new ORPCError("NOT_FOUND", {
      message: "Team not found.",
    });
  }
  const customerName = organizationRecord.name;
  const providerProductId = getBillingProductId(input.product);
  const rows = await db
    .select({
      plan: billingSubscription.plan,
      metadata: billingSubscription.metadata,
      providerSubscriptionId: billingSubscription.providerSubscriptionId,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
    })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.organizationId, input.organizationId),
        inArray(billingSubscription.plan, ["managed", "pro"]),
      ),
    )
    .orderBy(desc(billingSubscription.updatedAt));
  const activeSubscription = rows.find(
    (row) =>
      isActiveBillingStatus(row.status) &&
      subscriptionBelongsToOrganization(row.metadata, input.organizationId),
  );

  if (activeSubscription) {
    if (activeSubscription.plan !== input.product) {
      const updatedSubscription = await (
        await getPolarClient()
      ).subscriptions.update({
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
    teamCustomerId = (await polar.customers.getExternal({ externalId: externalCustomerId })).id;
  } catch (error) {
    if (!(error instanceof ResourceNotFound)) throw error;

    teamCustomerId = (
      await polar.customers.create({
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
      })
    ).id;
  }

  const checkout = await polar.checkouts.create({
    allowDiscountCodes: true,
    customerId: teamCustomerId,
    metadata: checkoutMetadata.metadata,
    products: [providerProductId],
    returnUrl: cancelUrl,
    successUrl,
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
  const session = await (
    await getPolarClient()
  ).customerSessions.create(
    createBillingPortalSession({
      organizationId: input.organizationId,
      returnUrl,
      userId: input.userId,
    }),
  );

  return { portalUrl: session.customerPortalUrl };
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

const serializeEntitlement = async (
  entitlement: Awaited<ReturnType<typeof getOrganizationBillingEntitlement>>,
) => {
  const usage = entitlement.account ? await getBillingCreditUsage(entitlement.account) : null;

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
            Math.max(0, usage.creditAmountMicroCents - usage.costMicroCents) / 1_000_000,
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
    memberships.map(async (membership) => ({
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
        }),
      )),
    })),
  );

  return { teams };
};

const getSyncedBillingProduct = (subscription: Subscription) => {
  const cachedProduct = getProductForProviderProductId(subscription.productId);
  if (cachedProduct) return cachedProduct;

  const providerProductMetadata = subscription.product.metadata[BILLING_METADATA_PRODUCT];
  const providerProductMatch = getProductForPolarMetadataKey(
    typeof providerProductMetadata === "string" ? providerProductMetadata : undefined,
  );
  if (providerProductMatch) return providerProductMatch;

  const metadataProduct = billingProductIdSchema.safeParse(
    subscription.metadata?.[BILLING_METADATA_PRODUCT],
  );
  if (metadataProduct.success) return metadataProduct.data;

  const legacyPlan = subscription.metadata?.[BILLING_METADATA_LEGACY_PLAN];
  if (legacyPlan === "managed" || legacyPlan === "pro") return legacyPlan;

  return null;
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

export const syncBillingCheckout = async (input: { checkoutId: string; userId: string }) => {
  const polar = await getPolarClient();
  const checkout = await polar.checkouts.get({ id: input.checkoutId });
  const checkoutUserId = checkout.metadata[BILLING_METADATA_USER_ID];

  if (checkout.status !== "succeeded" || checkoutUserId !== input.userId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This checkout cannot be applied to your billing account.",
    });
  }

  let subscription: Subscription | undefined;
  if (checkout.subscriptionId) {
    subscription = await polar.subscriptions.get({
      id: checkout.subscriptionId,
    });
  } else if (checkout.customerId && checkout.productId) {
    const subscriptions = await polar.subscriptions.list({
      active: true,
      customerId: checkout.customerId,
      limit: 10,
      productId: checkout.productId,
      sorting: ["-started_at"],
    });
    subscription = subscriptions.result.items.find(
      (candidate) => candidate.metadata[BILLING_METADATA_USER_ID] === input.userId,
    );
  }

  if (!subscription) {
    console.error("Could not resolve the subscription created by a completed checkout.", {
      checkoutId: checkout.id,
      customerId: checkout.customerId,
      productId: checkout.productId,
      userId: input.userId,
    });
    throw new ORPCError("BAD_REQUEST", {
      message: "We could not activate your plan. Please contact support.",
    });
  }

  return await syncBillingSubscription(subscription);
};

export const reportAiUsage = async (input: {
  chatId?: string | null;
  completionTokens: number;
  externalId: string;
  mailboxId?: string;
  model: keyof typeof aiUsageRates;
  promptTokens: number;
  usageKind: Extract<BillingUsageKind, "aiChat" | "autoLabel" | "usefulDetails">;
  userId: string;
}) => {
  const rates = aiUsageRates[input.model];
  const promptCostCents = (input.promptTokens / 1_000_000) * rates.prompt;
  const completionCostCents = (input.completionTokens / 1_000_000) * rates.completion;
  const costMicroCents = applyAiUsageMarkup(
    Math.round((promptCostCents + completionCostCents) * 1_000_000),
  );
  if (costMicroCents <= 0) return;

  if (!input.mailboxId) return;
  const [mailboxRow] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (!mailboxRow) return;

  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: mailboxRow.organizationId,
    userId: input.userId,
  });
  if (!entitlement.account) return;

  await recordBillingCreditUsage({
    account: entitlement.account,
    category: "ai",
    costMicroCents,
    dedupeKey: `ai:${input.externalId}`,
    metadata: {
      chatId: input.chatId ?? "",
      completionTokens: input.completionTokens,
      model: input.model,
      promptTokens: input.promptTokens,
      usageKind: input.usageKind,
    },
  });
};

export const reportAiUsageCost = async (input: {
  chatId?: string | null;
  costMicroCents: number;
  durationSeconds?: number;
  externalId: string;
  mailboxId?: string;
  model: string;
  totalTokens?: number;
  usageKind: Extract<BillingUsageKind, "aiChat" | "autoLabel" | "usefulDetails">;
  userId: string;
}) => {
  const costMicroCents = applyAiUsageMarkup(input.costMicroCents);
  if (costMicroCents <= 0 || !input.mailboxId) return;

  const [mailboxRow] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (!mailboxRow) return;

  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: mailboxRow.organizationId,
    userId: input.userId,
  });
  if (!entitlement.account) return;

  await recordBillingCreditUsage({
    account: entitlement.account,
    category: "ai",
    costMicroCents,
    dedupeKey: `ai:${input.externalId}`,
    metadata: {
      chatId: input.chatId ?? "",
      durationSeconds: input.durationSeconds ?? 0,
      model: input.model,
      totalTokens: input.totalTokens ?? 0,
      usageKind: input.usageKind,
    },
  });
};
