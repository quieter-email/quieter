import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getOrganizationMailUsageQueryKey = (organizationId: string) =>
  ["organization-mail-usage", organizationId] as const;

export const organizationMailUsageQueryOptions = (organizationId: string, enabled = true) =>
  queryOptions({
    enabled,
    queryFn: () => rpc.organizationMailUsage.overview({ organizationId }),
    queryKey: getOrganizationMailUsageQueryKey(organizationId),
    staleTime: 30_000,
  });
