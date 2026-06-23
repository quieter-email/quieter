import { z } from "zod";
import { formatManagedUsagePriceFeature } from "./ses-pricing";

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
    currency: "eur",
    description: "A shared team credit balance for managed mail.",
    features: [
      "€10 in monthly team credits",
      "Managed sending and receiving",
      "Custom team domains",
      "Team API keys",
      formatManagedUsagePriceFeature("managed"),
    ],
    highlight: false,
    monthlyPriceCents: 1_500,
    name: "Managed",
    polarMetadataKey: "managed",
  },
  pro: {
    creditAmountCents: 2_000,
    currency: "eur",
    description: "A larger shared balance with managed mail and AI for team members.",
    features: [
      "€20 in monthly team credits",
      "Everything in Managed",
      "AI features",
      formatManagedUsagePriceFeature("pro"),
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
    currency: "eur";
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
