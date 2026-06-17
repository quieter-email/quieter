import type { Subscription } from "@paykit-sdk/core";
import type { createPolar as createPolarFactory } from "@paykit-sdk/polar";
import type { BillingPlan } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { PayKit } from "@paykit-sdk/core";
import { billingSubscription, db } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { desc, eq, and } from "drizzle-orm";
import {
  getUserBillingPlan,
  hasUnlimitedBillingAccess,
  isActiveBillingStatus,
} from "./entitlements";
import { getOrganizationMailMeteredPrice } from "./organization-mail-usage";
import { BILLING_PRODUCTS, paidBillingPlanSchema, type PaidBillingPlan } from "./plans";
import {
  getPolarApiOrganizationId,
  getPolarClient,
  getPolarSandboxMode,
  ingestPolarEvents,
} from "./polar";

const BILLING_PROVIDER = "polar" as const;
const BILLING_METADATA_PLAN = "quieterPlan";
const BILLING_METADATA_USER_ID = "quieterUserId";
const BILLING_METADATA_PRODUCT_KEY = "quieterProduct";
const BILLING_METADATA_METER_KEY = "quieterMeter";
const AI_USAGE_EVENT_NAME = "quieter.ai.llm_usage";
const AI_USAGE_METER_KEY = "quieter_ai_llm_cost";

type PolarProvider = ReturnType<typeof createPolarFactory>;
type Paykit = PayKit<PolarProvider>;

let paykit: Paykit | null = null;
const billingProductIdCache = new Map<PaidBillingPlan, string>();
let aiUsageMeterId: string | null = null;
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
      message: "Polar billing is not configured.",
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

const getBillingProductId = async (plan: PaidBillingPlan) => {
  const cachedProductId = billingProductIdCache.get(plan);
  if (cachedProductId) return cachedProductId;

  const product = BILLING_PRODUCTS[plan];
  const polar = await getPolarClient();
  const organizationId = getPolarApiOrganizationId();
  const products = await polar.products.list({
    isArchived: false,
    isRecurring: true,
    limit: 100,
    metadata: {
      [BILLING_METADATA_PRODUCT_KEY]: product.polarMetadataKey,
    },
    organizationId,
  });
  const existingProduct = products.result.items.find(
    (candidate) => candidate.metadata[BILLING_METADATA_PRODUCT_KEY] === product.polarMetadataKey,
  );

  if (existingProduct) {
    const organizationMailMeteredPrice = await getOrganizationMailMeteredPrice();
    const hasOrganizationMailMeteredPrice = existingProduct.prices.some(
      (price) =>
        price.amountType === "metered_unit" &&
        "meterId" in price &&
        price.meterId === organizationMailMeteredPrice.meterId,
    );

    if (!hasOrganizationMailMeteredPrice) {
      await polar.products.update({
        id: existingProduct.id,
        productUpdate: {
          prices: [
            ...existingProduct.prices
              .filter((price) => !price.isArchived)
              .map((price) => ({ id: price.id })),
            organizationMailMeteredPrice,
          ],
        },
      });
    }

    billingProductIdCache.set(plan, existingProduct.id);
    return existingProduct.id;
  }

  const organizationMailMeteredPrice = await getOrganizationMailMeteredPrice();

  const createdProduct = await polar.products.create({
    description: product.description,
    metadata: {
      [BILLING_METADATA_PLAN]: plan,
      [BILLING_METADATA_PRODUCT_KEY]: product.polarMetadataKey,
    },
    name: `Quieter ${product.name}`,
    organizationId,
    prices: [
      {
        amountType: "fixed",
        priceAmount: product.monthlyPriceCents,
        priceCurrency: "usd",
      },
      organizationMailMeteredPrice,
    ],
    recurringInterval: "month",
  });

  billingProductIdCache.set(plan, createdProduct.id);
  return createdProduct.id;
};

const getPlanForProductId = (productId: string) => {
  for (const [plan, cachedProductId] of billingProductIdCache.entries()) {
    if (cachedProductId === productId) {
      return plan;
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

  if (billing) {
    url.searchParams.set("billing", billing);
  }

  return url.toString();
};

const getCustomerId = (subscription: Subscription) => {
  if (!subscription.customer || !("id" in subscription.customer)) return null;

  return String(subscription.customer.id);
};

const getSyncedBillingPlan = (subscription: Subscription): BillingPlan | null => {
  const metadataPlan = subscription.metadata?.[BILLING_METADATA_PLAN];
  const parsedMetadataPlan = paidBillingPlanSchema.safeParse(metadataPlan);

  if (parsedMetadataPlan.success) return parsedMetadataPlan.data;

  return getPlanForProductId(subscription.item_id);
};

export const createBillingCheckout = async (input: {
  customerEmail: string;
  customerName: string;
  headers: Headers;
  plan: PaidBillingPlan;
  userId: string;
}) => {
  const successUrl = getSettingsUrl(input.headers, "success");
  const cancelUrl = getSettingsUrl(input.headers, "canceled");
  const checkout = await (
    await getPaykit()
  ).checkouts.create({
    cancel_url: cancelUrl,
    customer: { email: input.customerEmail },
    item_id: await getBillingProductId(input.plan),
    metadata: {
      [BILLING_METADATA_PLAN]: input.plan,
      [BILLING_METADATA_USER_ID]: input.userId,
    },
    provider_metadata: {
      allowDiscountCodes: true,
      customerMetadata: {
        [BILLING_METADATA_USER_ID]: input.userId,
      },
      customerName: input.customerName,
      externalCustomerId: `user:${input.userId}`,
      returnUrl: cancelUrl,
    },
    quantity: 1,
    session_type: "one_time",
    success_url: successUrl,
  });

  return {
    checkoutUrl: checkout.payment_url,
  };
};

export const getBillingOverview = async (input: { userId: string }) => {
  const rows = await db
    .select({
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      plan: billingSubscription.plan,
      provider: billingSubscription.provider,
      providerSubscriptionId: billingSubscription.providerSubscriptionId,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.userId, input.userId))
    .orderBy(desc(billingSubscription.updatedAt));
  const subscription = rows.find((row) => isActiveBillingStatus(row.status)) ?? rows[0] ?? null;

  return {
    hasUnlimitedAccess: await hasUnlimitedBillingAccess(input.userId),
    plan: await getUserBillingPlan(input.userId),
    subscription,
  };
};

export const syncBillingSubscription = async (subscription: Subscription) => {
  const userId = subscription.metadata?.[BILLING_METADATA_USER_ID]?.trim();
  const plan = getSyncedBillingPlan(subscription);

  if (!userId || !plan) {
    console.warn("Skipping Polar subscription without Quieter billing metadata.", {
      itemId: subscription.item_id,
      subscriptionId: subscription.id,
    });

    return { synced: false };
  }

  const now = new Date();
  const [existingSubscription] = await db
    .select({
      id: billingSubscription.id,
    })
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
    plan,
    provider: BILLING_PROVIDER,
    providerCustomerId: getCustomerId(subscription),
    providerProductId: subscription.item_id,
    providerSubscriptionId: subscription.id,
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

const getAiUsageMeterId = async () => {
  if (aiUsageMeterId) return aiUsageMeterId;

  const polar = await getPolarClient();
  const organizationId = getPolarApiOrganizationId();
  const meters = await polar.meters.list({
    limit: 100,
    metadata: {
      [BILLING_METADATA_METER_KEY]: AI_USAGE_METER_KEY,
    },
    organizationId,
  });
  const existingMeter = meters.result.items.find(
    (meter) => meter.metadata[BILLING_METADATA_METER_KEY] === AI_USAGE_METER_KEY,
  );

  if (existingMeter) {
    aiUsageMeterId = existingMeter.id;
    return existingMeter.id;
  }

  const createdMeter = await polar.meters.create({
    aggregation: {
      func: "sum",
      property: "costCents",
    },
    filter: {
      clauses: [
        {
          operator: "eq",
          property: "name",
          value: AI_USAGE_EVENT_NAME,
        },
      ],
      conjunction: "and",
    },
    metadata: {
      [BILLING_METADATA_METER_KEY]: AI_USAGE_METER_KEY,
    },
    name: "Quieter AI LLM cost",
    organizationId,
  });

  aiUsageMeterId = createdMeter.id;
  return createdMeter.id;
};

export const reportAiUsage = async (input: {
  chatId?: string | null;
  completionTokens: number;
  externalId?: string;
  model: keyof typeof aiUsageRates;
  promptTokens: number;
  userId: string;
}) => {
  const rates = aiUsageRates[input.model];

  const promptCostCents = (input.promptTokens / 1_000_000) * rates.prompt;
  const completionCostCents = (input.completionTokens / 1_000_000) * rates.completion;
  const costCents = Number((promptCostCents + completionCostCents).toFixed(8));

  if (costCents <= 0) return;

  await getAiUsageMeterId();
  const event = {
    externalCustomerId: `user:${input.userId}`,
    metadata: {
      chatId: input.chatId ?? "",
      completionTokens: input.completionTokens,
      costCents,
      model: input.model,
      promptTokens: input.promptTokens,
    },
    name: AI_USAGE_EVENT_NAME,
    organizationId: getPolarApiOrganizationId(),
  };

  if (input.externalId) {
    await ingestPolarEvents([{ ...event, externalId: input.externalId }]);
    return;
  }

  await (await getPolarClient()).events.ingest({ events: [event] });
};

export const handlePolarBillingWebhook = async (input: {
  body: string;
  fullUrl: string;
  headers: Headers;
}) => {
  const webhookSecret = serverEnv.POLAR_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Polar webhook secret is not configured.",
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
