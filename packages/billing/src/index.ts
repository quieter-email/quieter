import type { Subscription } from "@paykit-sdk/core";
import type { createPolar as createPolarFactory } from "@paykit-sdk/polar";
import type { BillingPlan, BillingSubscriptionStatus } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { PayKit } from "@paykit-sdk/core";
import { auth } from "@quieter/auth";
import { billingSubscription, db } from "@quieter/database";
import { desc, eq, and } from "drizzle-orm";
import { paidBillingPlanSchema, type PaidBillingPlan } from "./plans";

const BILLING_PROVIDER = "polar" as const;
const BILLING_METADATA_PLAN = "quieterPlan";
const BILLING_METADATA_USER_ID = "quieterUserId";
const ACTIVE_BILLING_STATUSES = new Set<BillingSubscriptionStatus>([
  "active",
  "past_due",
  "pending",
  "trialing",
]);
const BILLING_PLAN_PRODUCT_ENV = {
  managed: "QUIETER_POLAR_MANAGED_PRODUCT_ID",
  pro: "QUIETER_POLAR_PRO_PRODUCT_ID",
} as const satisfies Record<PaidBillingPlan, string>;

type PolarProvider = ReturnType<typeof createPolarFactory>;
type Paykit = PayKit<PolarProvider>;

let paykit: Paykit | null = null;

const getPaykit = async () => {
  if (paykit) return paykit;

  const accessToken = process.env.POLAR_ACCESS_TOKEN?.trim();

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

const getPolarSandboxMode = () => {
  const configured = process.env.POLAR_SANDBOX?.trim().toLowerCase();

  if (configured) {
    return ["1", "true", "yes", "on"].includes(configured);
  }

  return process.env.NODE_ENV !== "production";
};

const getBillingProductId = (plan: PaidBillingPlan) => {
  const productId = process.env[BILLING_PLAN_PRODUCT_ENV[plan]]?.trim();

  if (!productId) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `Missing ${BILLING_PLAN_PRODUCT_ENV[plan]} for Polar checkout.`,
    });
  }

  return productId;
};

const getPlanForProductId = (productId: string) => {
  for (const plan of paidBillingPlanSchema.options) {
    if (process.env[BILLING_PLAN_PRODUCT_ENV[plan]]?.trim() === productId) {
      return plan;
    }
  }

  return null;
};

const getBaseUrl = (headers: Headers) => {
  const configured = process.env.BETTER_AUTH_URL?.trim();

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
  headers: Headers;
  plan: PaidBillingPlan;
  userId: string;
}) => {
  const session = await auth.api.getSession({ headers: input.headers });

  if (!session?.user) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Sign in before starting checkout.",
    });
  }

  if (session.user.id !== input.userId) {
    throw new ORPCError("FORBIDDEN", {
      message: "You can only manage your own plan.",
    });
  }

  const successUrl = getSettingsUrl(input.headers, "success");
  const cancelUrl = getSettingsUrl(input.headers, "canceled");
  const checkout = await (
    await getPaykit()
  ).checkouts.create({
    cancel_url: cancelUrl,
    customer: { email: session.user.email },
    item_id: getBillingProductId(input.plan),
    metadata: {
      [BILLING_METADATA_PLAN]: input.plan,
      [BILLING_METADATA_USER_ID]: input.userId,
    },
    provider_metadata: {
      allowDiscountCodes: true,
      customerMetadata: {
        [BILLING_METADATA_USER_ID]: input.userId,
      },
      customerName: session.user.name,
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
  const subscription =
    rows.find((row) => ACTIVE_BILLING_STATUSES.has(row.status)) ?? rows[0] ?? null;

  return {
    plan:
      subscription && ACTIVE_BILLING_STATUSES.has(subscription.status) ? subscription.plan : "free",
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

export const handlePolarBillingWebhook = async (input: {
  body: string;
  fullUrl: string;
  headers: Headers;
}) => {
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET?.trim();

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
