import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export const getOrganizationDivisionsQueryKey = (organizationId: string) =>
  ["organization", organizationId, "divisions"] as const;

export const organizationDivisionsQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.organization.listDivisions({ organizationId }, { signal }),
    queryKey: getOrganizationDivisionsQueryKey(organizationId),
    staleTime: 30_000,
  });
