import { z } from "zod";
import { formatManagedUsagePriceFeature } from "./ses-pricing";

export const PAID_BILLING_PLANS = ["managed", "pro"] as const;
export const paidBillingPlanSchema = z.enum(PAID_BILLING_PLANS);
export const BILLING_PLAN_IDS = ["free", ...PAID_BILLING_PLANS] as const;
export const billingPlanSchema = z.enum(BILLING_PLAN_IDS);

export type PaidBillingPlan = (typeof PAID_BILLING_PLANS)[number];
export type BillingPlan = "free" | PaidBillingPlan;

export type BillingFeature =
  | "aiChat"
  | "gmailAutomation"
  | "organizationApiKeys"
  | "organizationDomains"
  | "organizationMail";

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
  gmailAutomation: {
    description: "Live Gmail updates and AI assistance",
    requiredPlan: "pro",
  },
  organizationApiKeys: {
    description: "organization API keys",
    requiredPlan: "managed",
  },
  organizationDomains: {
    description: "custom organization domains",
    requiredPlan: "managed",
  },
  organizationMail: {
    description: "organization mail API sending",
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
    description: "Hosted organization mailboxes, custom domains, and API-key sending.",
    features: [
      "Managed sending and receiving",
      "Custom organization domains",
      "Organization API keys",
      formatManagedUsagePriceFeature("managed"),
    ],
    highlight: false,
    monthlyPriceCents: 1_000,
    name: "Managed",
    polarMetadataKey: "quieter_managed",
  },
  pro: {
    description: "Managed mail plus AI chat, live Gmail updates, and automatic organization.",
    features: [
      "Everything in Managed",
      formatManagedUsagePriceFeature("pro"),
      "AI chat",
      "$10 AI credits included",
      "Instant Gmail updates",
      "AI auto-labeling",
      "Time-sensitive details from new mail",
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
