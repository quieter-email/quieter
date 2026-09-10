import { z } from "zod";

export const BILLING_PRODUCT_IDS = ["managed", "pro"] as const;
export const billingProductIdSchema = z.enum(BILLING_PRODUCT_IDS);

export type BillingProductId = (typeof BILLING_PRODUCT_IDS)[number];
export type PaidBillingPlan = BillingProductId;
export type BillingPlan = "free" | BillingProductId;

export const GMAIL_MAILBOX_LIMITS = {
  free: 5,
  managed: 25,
  pro: 100,
} as const satisfies Record<BillingPlan, number>;

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
    description: "AI assistance for Gmail",
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
    creditAmountCents: 1000,
    currency: "usd",
    description:
      "Managed mail for your team with a shared monthly usage balance.",
    features: [
      "Up to 25 Gmail accounts per team, with live updates",
      "$10 monthly usage balance",
      "Managed sending and receiving",
      "Custom team domains",
      "Team API keys",
      "Managed mail from $0.20 per 1,000 messages",
    ],
    highlight: false,
    monthlyPriceCents: 1500,
    name: "Managed",
    polarMetadataKey: "managed",
  },
  pro: {
    creditAmountCents: 2000,
    currency: "usd",
    description:
      "Managed mail and AI for every team member with a larger shared balance.",
    features: [
      "$20 monthly usage balance",
      "Everything in Managed",
      "Up to 100 Gmail accounts per team, with live updates",
      "AI features",
      "AI usage at model cost plus 15%",
    ],
    highlight: true,
    monthlyPriceCents: 2500,
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
