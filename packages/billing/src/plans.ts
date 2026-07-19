import { z } from "zod";

export const BILLING_PRODUCT_IDS = ["managed", "pro"] as const;
export const billingProductIdSchema = z.enum(BILLING_PRODUCT_IDS);
export const billingPlanSchema = z.enum(["free", ...BILLING_PRODUCT_IDS]);

export type BillingProductId = (typeof BILLING_PRODUCT_IDS)[number];
export type PaidBillingPlan = BillingProductId;
export type BillingPlan = "free" | BillingProductId;

export type BillingFeature =
  | "aiChat"
  | "gmailAutomation"
  | "organizationApiKeys"
  | "organizationDomains"
  | "organizationMail";

export const BILLING_FEATURES = {
  aiChat: {
    description: "AI chat",
    requirementLabel: "Pro",
    type: "ai",
  },
  gmailAutomation: {
    description: "Live Gmail updates and AI assistance",
    requirementLabel: "Pro",
    type: "ai",
  },
  organizationApiKeys: {
    description: "team API keys",
    requirementLabel: "Managed",
    type: "team",
  },
  organizationDomains: {
    description: "custom team domains",
    requirementLabel: "Managed",
    type: "team",
  },
  organizationMail: {
    description: "team mail",
    requirementLabel: "Managed",
    type: "team",
  },
} as const satisfies Record<
  BillingFeature,
  {
    description: string;
    requirementLabel: string;
    type: "ai" | "team";
  }
>;

export const BILLING_PRODUCTS = {
  managed: {
    creditAmountCents: 1_000,
    currency: "usd",
    description: "Managed mail for your team with a shared monthly usage balance.",
    features: [
      "$10 monthly usage balance",
      "Managed sending and receiving",
      "Custom team domains",
      "Team API keys",
      "Managed mail from $0.20 per 1,000 messages",
    ],
    highlight: false,
    monthlyPriceCents: 1_500,
    name: "Managed",
    polarMetadataKey: "managed",
  },
  pro: {
    creditAmountCents: 2_000,
    currency: "usd",
    description: "Managed mail and AI for every team member with a larger shared balance.",
    features: [
      "$20 monthly usage balance",
      "Everything in Managed",
      "AI features",
      "AI usage at model cost plus 15%",
    ],
    highlight: true,
    monthlyPriceCents: 2_500,
    name: "Pro",
    polarMetadataKey: "pro",
  },
} as const satisfies Record<
  BillingProductId,
  {
    creditAmountCents: number;
    currency: "usd";
    description: string;
    features: string[];
    highlight: boolean;
    monthlyPriceCents: number;
    name: string;
    polarMetadataKey: string;
  }
>;

export const productHasAi = (product: BillingProductId) => product === "pro";

export const productHasManagedMail = (_product: BillingProductId) => true;

export const getBillingFeatureRequirement = (feature: BillingFeature) => BILLING_FEATURES[feature];
