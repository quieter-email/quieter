import { z } from "zod";
import { formatManagedUsagePriceFeature } from "./ses-pricing";

export const BILLING_PRODUCT_IDS = ["personal", "team", "team_ai"] as const;
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
    requirementLabel: "Personal or Team + AI",
    type: "ai",
  },
  gmailAutomation: {
    description: "Live Gmail updates and AI assistance",
    requirementLabel: "Personal or Team + AI",
    type: "ai",
  },
  organizationApiKeys: {
    description: "organization API keys",
    requirementLabel: "Team",
    type: "team",
  },
  organizationDomains: {
    description: "custom organization domains",
    requirementLabel: "Team",
    type: "team",
  },
  organizationMail: {
    description: "organization mail",
    requirementLabel: "Team",
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
  personal: {
    creditAmountCents: 1_000,
    description: "A personal credit balance for Quieter AI across your mailboxes.",
    features: ["$10 in monthly credits", "AI chat", "AI organization and useful details"],
    highlight: false,
    monthlyPriceCents: 1_000,
    name: "Personal",
    polarMetadataKey: "quieter_personal_credits",
    scope: "personal",
  },
  team: {
    creditAmountCents: 1_000,
    description: "A shared organization credit balance for managed mail.",
    features: [
      "$10 in monthly team credits",
      "Managed sending and receiving",
      "Custom organization domains",
      "Organization API keys",
      formatManagedUsagePriceFeature("managed"),
    ],
    highlight: false,
    monthlyPriceCents: 1_000,
    name: "Team",
    polarMetadataKey: "quieter_team_credits",
    scope: "team",
  },
  team_ai: {
    creditAmountCents: 2_000,
    description: "A larger shared balance with managed mail and AI for team members.",
    features: [
      "$20 in monthly team credits",
      "Everything in Team",
      "AI features",
      formatManagedUsagePriceFeature("pro"),
    ],
    highlight: true,
    monthlyPriceCents: 2_000,
    name: "Team + AI",
    polarMetadataKey: "quieter_team_ai_credits",
    scope: "team",
  },
} as const satisfies Record<
  BillingProductId,
  {
    creditAmountCents: number;
    description: string;
    features: string[];
    highlight: boolean;
    monthlyPriceCents: number;
    name: string;
    polarMetadataKey: string;
    scope: "personal" | "team";
  }
>;

export const productHasAi = (product: BillingProductId) =>
  product === "personal" || product === "team_ai";

export const productHasManagedMail = (product: BillingProductId) =>
  product === "team" || product === "team_ai";

export const getBillingFeatureRequirement = (feature: BillingFeature) => BILLING_FEATURES[feature];
