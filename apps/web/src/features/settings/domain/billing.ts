import type { RouterOutputs } from "@quieter/orpc";
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

export const formatBillingPlan = (plan: UserBillingPlan) => {
  if (plan === "managed") return "Managed";
  if (plan === "pro") return "Pro";
  return "Free";
};

export const formatBillingStatus = (
  status: NonNullable<UserBillingOverview["subscription"]>["status"],
) => {
  if (status === "active") return "Active";
  if (status === "canceled") return "Canceled";
  if (status === "expired") return "Expired";
  if (status === "past_due") return "Past due";
  if (status === "trialing") return "Trialing";
  return "Pending";
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
    description: "Hosted mailboxes with a predictable included mail allowance.",
    features: [
      "Managed sending and receiving",
      "$10 AWS SES usage included",
      "Overages at SES + 5%",
    ],
    highlight: false,
    name: "Managed",
    plan: "managed",
    price: "$10",
  },
  {
    description: "Managed mail plus AI credits and live Gmail infrastructure.",
    features: ["Everything in Managed", "$10 AI credits included", "Gmail Pub/Sub support"],
    highlight: true,
    name: "Pro",
    plan: "pro",
    price: "$20",
  },
] as const;
