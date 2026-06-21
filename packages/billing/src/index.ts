import type { Subscription } from "@paykit-sdk/core";
import type { createPolar as createPolarFactory } from "@paykit-sdk/polar";
import type { BillingPlan as StoredBillingPlan, BillingScope } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { PayKit } from "@paykit-sdk/core";
import { billingSubscription, db, mailbox, member, organization } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  getBillingCreditUsage,
  getCreditUsageMeteredPrice,
  recordBillingCreditUsage,
} from "./credits";
import {
  getOrganizationBillingEntitlement,
  getPersonalBillingEntitlement,
  hasUserBillingFeature,
  isActiveBillingStatus,
} from "./entitlements";
import { BILLING_PRODUCTS, billingProductIdSchema, type BillingProductId } from "./plans";
import { getPolarApiOrganizationId, getPolarClient, getPolarSandboxMode } from "./polar";

const BILLING_PROVIDER = "polar" as const;
const BILLING_METADATA_PRODUCT = "quieterProduct";
const BILLING_METADATA_SCOPE = "quieterScope";
const BILLING_METADATA_USER_ID = "quieterUserId";
const BILLING_METADATA_ORGANIZATION_ID = "quieterOrganizationId";
const BILLING_METADATA_LEGACY_PLAN = "quieterPlan";

type PolarProvider = ReturnType<typeof createPolarFactory>;
type Paykit = PayKit<PolarProvider>;

let paykit: Paykit | null = null;
const billingProductIdCache = new Map<BillingProductId, string>();
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

const getPaykit = async () => {
  if (paykit) return paykit;

  const accessToken = serverEnv.POLAR_ACCESS_TOKEN;

  if (!accessToken) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Billing is not configured.",
    });
  }

  const { createPolar } = await import("@paykit-sdk/polar");

  paykit = new PayKit(
    createPolar({
      accessToken,
      isSandbox: getPolarSandboxMode(),
    }),
  );

  return paykit;
};

const getBillingProductId = async (productId: BillingProductId) => {
  const cachedProductId = billingProductIdCache.get(productId);
  if (cachedProductId) return cachedProductId;

  const product = BILLING_PRODUCTS[productId];
  const polar = await getPolarClient();
  const organizationId = getPolarApiOrganizationId();
  const products = await polar.products.list({
    isArchived: false,
    isRecurring: true,
    limit: 100,
    metadata: {
      [BILLING_METADATA_PRODUCT]: product.polarMetadataKey,
    },
    organizationId,
  });
  const existingProduct = products.result.items.find(
    (candidate) => candidate.metadata[BILLING_METADATA_PRODUCT] === product.polarMetadataKey,
  );
  const creditUsageMeteredPrice = await getCreditUsageMeteredPrice();

  if (existingProduct) {
    const hasCreditUsageMeteredPrice = existingProduct.prices.some(
      (price) =>
        price.amountType === "metered_unit" &&
        "meterId" in price &&
        price.meterId === creditUsageMeteredPrice.meterId,
    );

    if (!hasCreditUsageMeteredPrice) {
      await polar.products.update({
        id: existingProduct.id,
        productUpdate: {
          prices: [
            ...existingProduct.prices
              .filter((price) => !price.isArchived)
              .map((price) => ({ id: price.id })),
            creditUsageMeteredPrice,
          ],
        },
      });
    }

    billingProductIdCache.set(productId, existingProduct.id);
    return existingProduct.id;
  }

  const createdProduct = await polar.products.create({
    description: product.description,
    metadata: {
      [BILLING_METADATA_PRODUCT]: product.polarMetadataKey,
    },
    name: `Quieter ${product.name}`,
    organizationId,
    prices: [
      {
        amountType: "fixed",
        priceAmount: product.monthlyPriceCents,
        priceCurrency: "usd",
      },
      creditUsageMeteredPrice,
    ],
    recurringInterval: "month",
  });

  billingProductIdCache.set(productId, createdProduct.id);
  return createdProduct.id;
};

const getProductForProviderProductId = (providerProductId: string) => {
  for (const [product, cachedProductId] of billingProductIdCache.entries()) {
    if (cachedProductId === providerProductId) return product;
  }

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

const getSettingsUrl = (headers: Headers, billing?: "canceled" | "success") => {
  const url = new URL("/settings", getBaseUrl(headers));
  url.searchParams.set("tab", "plan");
  if (billing) url.searchParams.set("billing", billing);
  return url.toString();
};

const getCustomerId = (subscription: Subscription) => {
  if (!subscription.customer || !("id" in subscription.customer)) return null;
  return String(subscription.customer.id);
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

  if (product.scope === "team" && !input.organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose an organization for team billing.",
    });
  }

  if (product.scope === "personal" && input.organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Personal billing cannot be assigned to an organization.",
    });
  }

  const successUrl = getSettingsUrl(input.headers, "success");
  const cancelUrl = getSettingsUrl(input.headers, "canceled");
  const providerProductId = await getBillingProductId(input.product);
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
      await (
        await getPolarClient()
      ).subscriptions.update({
        id: activeSubscription.providerSubscriptionId,
        subscriptionUpdate: {
          productId: providerProductId,
          prorationBehavior: "invoice",
        },
      });
    }

    return { checkoutUrl: successUrl };
  }

  const externalCustomerId =
    product.scope === "team" ? `organization:${input.organizationId}` : `user:${input.userId}`;
  const checkout = await (
    await getPaykit()
  ).checkouts.create({
    cancel_url: cancelUrl,
    customer: { email: input.customerEmail },
    item_id: providerProductId,
    metadata: {
      [BILLING_METADATA_ORGANIZATION_ID]: input.organizationId ?? "",
      [BILLING_METADATA_PRODUCT]: input.product,
      [BILLING_METADATA_SCOPE]: product.scope,
      [BILLING_METADATA_USER_ID]: input.userId,
    },
    provider_metadata: {
      allowDiscountCodes: true,
      customerMetadata: {
        [BILLING_METADATA_ORGANIZATION_ID]: input.organizationId ?? "",
        [BILLING_METADATA_USER_ID]: input.userId,
      },
      customerName: input.customerName,
      externalCustomerId,
      returnUrl: cancelUrl,
    },
    quantity: 1,
    session_type: "one_time",
    success_url: successUrl,
  });

  return { checkoutUrl: checkout.payment_url };
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

const getSyncedBillingProduct = async (subscription: Subscription) => {
  const cachedProduct = getProductForProviderProductId(subscription.item_id);
  if (cachedProduct) return cachedProduct;

  try {
    const providerProduct = await (
      await getPolarClient()
    ).products.get({
      id: subscription.item_id,
    });
    const providerProductMetadata = providerProduct.metadata[BILLING_METADATA_PRODUCT];
    const providerProductMatch = getProductForPolarMetadataKey(
      typeof providerProductMetadata === "string" ? providerProductMetadata : undefined,
    );
    if (providerProductMatch) {
      billingProductIdCache.set(providerProductMatch, subscription.item_id);
      return providerProductMatch;
    }
  } catch (error) {
    console.warn("Could not resolve the billing product from the provider.", {
      error,
      productId: subscription.item_id,
    });
  }

  const metadataProduct = billingProductIdSchema.safeParse(
    subscription.metadata?.[BILLING_METADATA_PRODUCT],
  );
  if (metadataProduct.success) return metadataProduct.data;

  const legacyPlan = subscription.metadata?.[BILLING_METADATA_LEGACY_PLAN];
  if (legacyPlan === "managed" || legacyPlan === "pro") return legacyPlan;

  return null;
};

export const syncBillingSubscription = async (subscription: Subscription) => {
  const userId = subscription.metadata?.[BILLING_METADATA_USER_ID]?.trim();
  const product = await getSyncedBillingProduct(subscription);

  if (!userId || !product) {
    console.warn("Skipping billing subscription without Quieter metadata.", {
      itemId: subscription.item_id,
      subscriptionId: subscription.id,
    });
    return { synced: false };
  }

  const parsedProduct = billingProductIdSchema.safeParse(product);
  const scope: BillingScope = parsedProduct.success
    ? BILLING_PRODUCTS[parsedProduct.data].scope
    : "personal";
  const organizationId =
    scope === "team"
      ? subscription.metadata?.[BILLING_METADATA_ORGANIZATION_ID]?.trim() || null
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
    currentPeriodEnd: subscription.current_period_end,
    currentPeriodStart: subscription.current_period_start,
    metadata: subscription.metadata ?? {},
    organizationId,
    plan: product as StoredBillingPlan,
    provider: BILLING_PROVIDER,
    providerCustomerId: getCustomerId(subscription),
    providerProductId: subscription.item_id,
    providerSubscriptionId: subscription.id,
    scope,
    status: subscription.status,
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

export const handlePolarBillingWebhook = async (input: {
  body: string;
  fullUrl: string;
  headers: Headers;
}) => {
  const webhookSecret = serverEnv.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Billing webhook verification is not configured.",
    });
  }

  const webhook = (await getPaykit()).webhooks
    .setup({ webhookSecret })
    .on("subscription.created", async (event) => {
      await syncBillingSubscription(event.data);
    })
    .on("subscription.updated", async (event) => {
      if (event.data) await syncBillingSubscription(event.data);
    })
    .on("subscription.canceled", async (event) => {
      if (event.data) await syncBillingSubscription(event.data);
    });

  await webhook.handle({
    body: input.body,
    fullUrl: input.fullUrl,
    headersAsObject: Object.fromEntries(input.headers),
  });
};
