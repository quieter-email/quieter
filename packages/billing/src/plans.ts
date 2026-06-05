import { z } from "zod";
import { formatSesUsagePriceFeature } from "./ses-pricing";

export const PAID_BILLING_PLANS = ["managed", "pro"] as const;
export const paidBillingPlanSchema = z.enum(PAID_BILLING_PLANS);
export const BILLING_PLAN_IDS = ["free", ...PAID_BILLING_PLANS] as const;
export const billingPlanSchema = z.enum(BILLING_PLAN_IDS);

export type PaidBillingPlan = (typeof PAID_BILLING_PLANS)[number];
export type BillingPlan = "free" | PaidBillingPlan;

export type BillingFeature = "aiChat" | "teamApiKeys" | "teamDomains" | "teamMail";

export const BILLING_PLAN_ORDER = {
  free: 0,
  managed: 1,
  pro: 2,
} as const satisfies Record<BillingPlan, number>;

export const BILLING_FEATURES = {
  aiChat: {
    description: "AI chat",
    requiredPlan: "pro",
  },
  teamApiKeys: {
    description: "team API keys",
    requiredPlan: "managed",
  },
  teamDomains: {
    description: "custom team domains",
    requiredPlan: "managed",
  },
  teamMail: {
    description: "team mail API sending",
    requiredPlan: "managed",
  },
} as const satisfies Record<
  BillingFeature,
  {
    description: string;
    requiredPlan: PaidBillingPlan;
  }
>;

export const BILLING_PRODUCTS = {
  managed: {
    description: "Hosted team mailboxes, custom domains, and API-key sending.",
    features: [
      "Managed sending and receiving",
      "Custom team domains",
      "Team API keys",
      formatSesUsagePriceFeature(),
    ],
    highlight: false,
    monthlyPriceCents: 1_000,
    name: "Managed",
    polarMetadataKey: "quieter_managed",
  },
  pro: {
    description: "Managed mail plus AI chat and live Gmail infrastructure.",
    features: [
      "Everything in Managed",
      "AI chat",
      "$10 AI credits included",
      "Gmail Pub/Sub support",
    ],
    highlight: true,
    monthlyPriceCents: 2_000,
    name: "Pro",
    polarMetadataKey: "quieter_pro",
  },
} as const satisfies Record<
  PaidBillingPlan,
  {
    description: string;
    features: string[];
    highlight: boolean;
    monthlyPriceCents: number;
    name: string;
    polarMetadataKey: string;
  }
>;

export const hasBillingPlanAccess = (plan: BillingPlan, requiredPlan: PaidBillingPlan) =>
  BILLING_PLAN_ORDER[plan] >= BILLING_PLAN_ORDER[requiredPlan];

export const getBillingFeatureRequirement = (feature: BillingFeature) => BILLING_FEATURES[feature];
