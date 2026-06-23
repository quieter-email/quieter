import type { RouterOutputs } from "@quieter/orpc";
import {
  BILLING_PRODUCTS,
  billingProductIdSchema,
  type BillingProductId,
} from "@quieter/billing/plans";
import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export type UserBillingOverview = RouterOutputs["billing"]["overview"];

export const USER_BILLING_QUERY_KEY = ["user-billing"] as const;

export const userBillingQueryOptions = () =>
  queryOptions({
    queryFn: () => rpc.billing.overview(),
    queryKey: USER_BILLING_QUERY_KEY,
    staleTime: 30_000,
  });

export const normalizeBillingProduct = (
  product: string | null | undefined,
): BillingProductId | null => {
  const parsedProduct = billingProductIdSchema.safeParse(product);
  return parsedProduct.success ? parsedProduct.data : null;
};

export const formatBillingProduct = (product: BillingProductId | null) =>
  product ? BILLING_PRODUCTS[product].name : "No paid billing";

export const getTeamBilling = (billing: UserBillingOverview | undefined, organizationId: string) =>
  billing?.teams.find((team) => team.organizationId === organizationId) ?? null;

export const hasOrganizationAiAccess = (
  billing: UserBillingOverview | undefined,
  organizationId: string,
) =>
  billing?.teams.some(
    (team) => team.organizationId === organizationId && team.product === "pro" && team.hasAccess,
  ) === true;
