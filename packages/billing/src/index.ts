import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import type {
  BillingPlan as StoredBillingPlan,
  BillingScope,
  BillingSubscriptionStatus,
} from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { billingSubscription, db, mailbox, member, organization } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getBillingCreditUsage, recordBillingCreditUsage } from "./credits";
import {
  getOrganizationBillingEntitlement,
  getPersonalBillingEntitlement,
  hasUserBillingFeature,
  isActiveBillingStatus,
} from "./entitlements";
import {
  BILLING_PRODUCTS,
  BILLING_PRODUCT_IDS,
  billingProductIdSchema,
  type BillingProductId,
} from "./plans";
import { getPolarClient } from "./polar";

const BILLING_PROVIDER = "polar" as const;
const BILLING_METADATA_PRODUCT = "quieterProduct";
const BILLING_METADATA_SCOPE = "quieterScope";
const BILLING_METADATA_USER_ID = "quieterUserId";
const BILLING_METADATA_ORGANIZATION_ID = "quieterOrganizationId";
const BILLING_METADATA_LEGACY_PLAN = "quieterPlan";

export const createBillingCheckoutMetadata = (input: {
  organizationId?: string;
  product: BillingProductId;
  scope: BillingScope;
  userId: string;
}) => {
  const organizationMetadata: Record<string, string> = input.organizationId
    ? { [BILLING_METADATA_ORGANIZATION_ID]: input.organizationId }
    : {};

  return {
    customerMetadata: {
      ...organizationMetadata,
      [BILLING_METADATA_USER_ID]: input.userId,
    },
    metadata: {
      ...organizationMetadata,
      [BILLING_METADATA_PRODUCT]: input.product,
      [BILLING_METADATA_SCOPE]: input.scope,
      [BILLING_METADATA_USER_ID]: input.userId,
    },
  };
};

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

const getBillingProductId = (productId: BillingProductId): string => {
  const polarProductId = {
    personal: serverEnv.POLAR_PRODUCT_PERSONAL_ID,
    team: serverEnv.POLAR_PRODUCT_TEAM_ID,
    team_ai: serverEnv.POLAR_PRODUCT_TEAM_AI_ID,
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
  if (serverEnv.POLAR_PRODUCT_PERSONAL_ID === providerProductId) return "personal";
  if (serverEnv.POLAR_PRODUCT_TEAM_ID === providerProductId) return "team";
  if (serverEnv.POLAR_PRODUCT_TEAM_AI_ID === providerProductId) return "team_ai";
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
  input:
    | {
        billing?: "canceled" | "success";
        organizationId: string;
        product: Exclude<BillingProductId, "personal">;
      }
    | {
        billing?: "canceled" | "success";
        product: "personal";
      },
) => {
  const url = new URL("/settings", getBaseUrl(headers));
  if (input.product !== "personal") {
    url.searchParams.set("tab", "organization");
    url.searchParams.set("organizationId", input.organizationId);
    url.searchParams.set("organizationView", "overview");
  } else {
    url.searchParams.set("tab", "plan");
  }

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
  organizationId?: string;
  product: BillingProductId;
  userId: string;
}) => {
  const product = BILLING_PRODUCTS[input.product];

  if (product.scope === "personal" && input.organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Personal billing cannot be assigned to an organization.",
    });
  }

  let successUrl: string;
  let cancelUrl: string;

  if (input.product === "personal") {
    successUrl = getSettingsUrl(input.headers, {
      billing: "success",
      product: input.product,
    });
    cancelUrl = getSettingsUrl(input.headers, {
      billing: "canceled",
      product: input.product,
    });
  } else {
    if (!input.organizationId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose an organization for team billing.",
      });
    }

    successUrl = getSettingsUrl(input.headers, {
      billing: "success",
      organizationId: input.organizationId,
      product: input.product,
    });
    cancelUrl = getSettingsUrl(input.headers, {
      billing: "canceled",
      organizationId: input.organizationId,
      product: input.product,
    });
  }
  successUrl = withCheckoutIdPlaceholder(successUrl);
  let customerName = input.customerName;
  if (product.scope === "team") {
    const [organizationRecord] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, input.organizationId!))
      .limit(1);

    if (!organizationRecord) {
      throw new ORPCError("NOT_FOUND", {
        message: "Organization not found.",
      });
    }

    customerName = organizationRecord.name;
  }
  const providerProductId = getBillingProductId(input.product);
  const rows = await db
    .select({
      plan: billingSubscription.plan,
      providerSubscriptionId: billingSubscription.providerSubscriptionId,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
    })
    .from(billingSubscription)
    .where(
      product.scope === "team"
        ? and(
            eq(billingSubscription.scope, "team"),
            eq(billingSubscription.organizationId, input.organizationId!),
            inArray(billingSubscription.plan, ["team", "team_ai"]),
          )
        : and(
            eq(billingSubscription.scope, "personal"),
            eq(billingSubscription.userId, input.userId),
            isNull(billingSubscription.organizationId),
            eq(billingSubscription.plan, "personal"),
          ),
    )
    .orderBy(desc(billingSubscription.updatedAt));
  const activeSubscription = rows.find((row) => isActiveBillingStatus(row.status));

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

  const externalCustomerId =
    product.scope === "team" ? `organization:${input.organizationId}` : input.userId;
  const checkoutMetadata = createBillingCheckoutMetadata({
    organizationId: input.organizationId,
    product: input.product,
    scope: product.scope,
    userId: input.userId,
  });
  const checkout = await (
    await getPolarClient()
  ).checkouts.create({
    allowDiscountCodes: true,
    customerEmail: input.customerEmail,
    customerMetadata: checkoutMetadata.customerMetadata,
    customerName,
    externalCustomerId,
    metadata: checkoutMetadata.metadata,
    products: [providerProductId],
    returnUrl: cancelUrl,
    successUrl,
  });

  return { checkoutUrl: checkout.url };
};

export const createBillingPortal = async (input: {
  headers: Headers;
  organizationId?: string;
  userId: string;
}) => {
  const returnUrl = input.organizationId
    ? getSettingsUrl(input.headers, {
        organizationId: input.organizationId,
        product: "team",
      })
    : getSettingsUrl(input.headers, { product: "personal" });
  const session = await (
    await getPolarClient()
  ).customerSessions.create({
    externalCustomerId: input.organizationId
      ? `organization:${input.organizationId}`
      : input.userId,
    returnUrl,
  });

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
  entitlement: Awaited<ReturnType<typeof getPersonalBillingEntitlement>>,
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
  const personal = await serializeEntitlement(await getPersonalBillingEntitlement(input.userId));
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

  return { personal, teams };
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

  const parsedProduct = billingProductIdSchema.safeParse(product);
  const scope: BillingScope = parsedProduct.success
    ? BILLING_PRODUCTS[parsedProduct.data].scope
    : "personal";
  const metadataOrganizationId = subscription.metadata[BILLING_METADATA_ORGANIZATION_ID];
  const organizationId =
    scope === "team" && typeof metadataOrganizationId === "string"
      ? metadataOrganizationId.trim() || null
      : null;

  if (scope === "team" && !organizationId) {
    console.warn("Skipping team subscription without an organization.", {
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
    scope,
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
  userId: string;
}) => {
  const rates = aiUsageRates[input.model];
  const promptCostCents = (input.promptTokens / 1_000_000) * rates.prompt;
  const completionCostCents = (input.completionTokens / 1_000_000) * rates.completion;
  const costMicroCents = Math.round((promptCostCents + completionCostCents) * 1_000_000);
  if (costMicroCents <= 0) return;

  let organizationId: string | undefined;
  if (input.mailboxId) {
    const [mailboxRow] = await db
      .select({ organizationId: mailbox.organizationId })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .limit(1);
    organizationId = mailboxRow?.organizationId ?? undefined;
  }

  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId,
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
    },
  });
};
