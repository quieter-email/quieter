import { rpc } from "@quieter/app/lib/orpc";
import { queryOptions } from "@tanstack/react-query";

export const getOrganizationMailUsageQueryKey = (organizationId: string) =>
  ["organization-mail-usage", organizationId] as const;

export const organizationMailUsageQueryOptions = (
  organizationId: string,
  enabled = true
) =>
  queryOptions({
    enabled,
    queryFn: async () =>
      await rpc.organizationMailUsage.overview({ organizationId }),
    queryKey: getOrganizationMailUsageQueryKey(organizationId),
    staleTime: 30_000,
  });
