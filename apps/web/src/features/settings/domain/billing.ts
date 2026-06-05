import type { RouterOutputs } from "@quieter/orpc";
import { BILLING_PRODUCTS, billingPlanSchema, type BillingPlan } from "@quieter/billing/plans";
import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export type UserBillingOverview = RouterOutputs["billing"]["overview"];
export type UserBillingPlan = UserBillingOverview["plan"];

export const USER_BILLING_QUERY_KEY = ["user-billing"] as const;

export const userBillingQueryOptions = () =>
  queryOptions({
    queryFn: () => rpc.billing.overview(),
    queryKey: USER_BILLING_QUERY_KEY,
    staleTime: 30_000,
  });

export const normalizeBillingPlan = (plan: UserBillingPlan | null | undefined): BillingPlan => {
  const parsedPlan = billingPlanSchema.safeParse(plan);

  return parsedPlan.success ? parsedPlan.data : "free";
};

export const formatBillingPlan = (plan: BillingPlan) => {
  if (plan === "managed") return "Managed";
  if (plan === "pro") return "Pro";
  return "Free";
};

export const formatBillingStatus = (
  status: NonNullable<UserBillingOverview["subscription"]>["status"],
): string => {
  switch (status) {
    case "active":
      return "Active";
    case "canceled":
      return "Canceled";
    case "expired":
      return "Expired";
    case "past_due":
      return "Past due";
    case "trialing":
      return "Trialing";
    case "pending":
      return "Pending";
    default: {
      const _exhaustiveCheck: never = status;
      throw new Error(`Unexpected billing status: ${_exhaustiveCheck}`);
    }
  }
};

export const BILLING_PLANS = [
  {
    description: "Gmail accounts, BYOK provider setup, and the core Quieter inbox.",
    features: ["Gmail mailboxes", "Personal workspace", "Bring your own keys"],
    highlight: false,
    name: "Free",
    plan: "free",
    price: "$0",
  },
  {
    description: BILLING_PRODUCTS.managed.description,
    features: BILLING_PRODUCTS.managed.features,
    highlight: BILLING_PRODUCTS.managed.highlight,
    name: BILLING_PRODUCTS.managed.name,
    plan: "managed",
    price: `$${BILLING_PRODUCTS.managed.monthlyPriceCents / 100}`,
  },
  {
    description: BILLING_PRODUCTS.pro.description,
    features: BILLING_PRODUCTS.pro.features,
    highlight: BILLING_PRODUCTS.pro.highlight,
    name: BILLING_PRODUCTS.pro.name,
    plan: "pro",
    price: `$${BILLING_PRODUCTS.pro.monthlyPriceCents / 100}`,
  },
] as const;
