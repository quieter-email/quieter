import {
  BILLING_PRODUCTS,
  billingProductIdSchema,
} from "@quieter/billing/plans";
import type { BillingProductId } from "@quieter/billing/plans";
import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export type UserBillingOverview = RouterOutputs["billing"]["overview"];

export const USER_BILLING_QUERY_KEY = ["user-billing"] as const;

const billingDateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

export const userBillingQueryOptions = () =>
  queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.billing.overview(undefined, { signal }),
    queryKey: USER_BILLING_QUERY_KEY,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

export const normalizeBillingProduct = (
  product: string | null | undefined
): BillingProductId | null => {
  const parsedProduct = billingProductIdSchema.safeParse(product);
  return parsedProduct.success ? parsedProduct.data : null;
};

export const formatBillingProduct = (product: BillingProductId | null) =>
  product === null ? "No paid billing" : BILLING_PRODUCTS[product].name;

export const getBillingStatusMessage = (
  billing: UserBillingOverview["teams"][number]
) => {
  if (billing.hasUnlimitedAccess || billing.subscription === null) {
    return null;
  }
  if (billing.hasAccess && billing.subscription.cancelAtPeriodEnd) {
    const end = billingDateFormatter.format(
      new Date(billing.subscription.currentPeriodEnd)
    );
    return `Your subscription ends on ${end}. Sending and API access continue until then. Open Manage billing to keep your subscription.`;
  }
  if (billing.hasAccess) {
    return null;
  }
  if (
    billing.subscription.status === "active" ||
    billing.subscription.status === "trialing"
  ) {
    return "Your subscription renewal has not been confirmed. Sending and API access are paused. Open Manage billing to review your subscription.";
  }
  if (billing.subscription.status === "past_due") {
    return "Your subscription needs attention. Sending and API access are paused. Open Manage billing to review your subscription.";
  }
  if (billing.subscription.status === "pending") {
    return "Your subscription is not active yet. Open Manage billing to review it.";
  }
  return "Your subscription has ended. Sending and API access are paused. Choose a plan to restore access.";
};

export const getTeamBilling = (
  billing: UserBillingOverview | undefined,
  organizationId: string
) =>
  billing?.teams.find((team) => team.organizationId === organizationId) ?? null;

export const hasOrganizationAiAccess = (
  billing: UserBillingOverview | undefined,
  organizationId: string
) =>
  billing?.teams.some(
    (team) =>
      team.organizationId === organizationId &&
      team.product === "pro" &&
      team.hasAccess &&
      (team.hasUnlimitedAccess || (team.usage?.remainingCreditCents ?? 0) > 0)
  ) === true;
