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

export const userBillingQueryOptions = () =>
  queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.billing.overview(undefined, { signal }),
    queryKey: USER_BILLING_QUERY_KEY,
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
