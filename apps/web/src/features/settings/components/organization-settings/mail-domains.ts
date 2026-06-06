import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export type OrganizationMailDomain = RouterOutputs["mailDomains"]["list"]["domains"][number];
export type OrganizationMailDomainStatus = OrganizationMailDomain["status"];
export type OrganizationMailDomainDnsRecord = OrganizationMailDomain["requiredDnsRecords"][number];

export const getOrganizationMailDomainsQueryKey = (organizationId: string) =>
  ["mail-domains", organizationId] as const;

export const organizationMailDomainsQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: () => rpc.mailDomains.list({ organizationId }),
    queryKey: getOrganizationMailDomainsQueryKey(organizationId),
    staleTime: 30_000,
  });

export const formatMailDomainStatus = (status: OrganizationMailDomainStatus) => {
  if (status === "verified") return "Verified";
  if (status === "pending_dns") return "Needs DNS";
  return "Check failed";
};
