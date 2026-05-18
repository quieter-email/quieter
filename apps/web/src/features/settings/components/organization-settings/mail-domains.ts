import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export type TeamMailDomain = RouterOutputs["mailDomains"]["list"]["domains"][number];
export type TeamMailDomainStatus = TeamMailDomain["status"];
export type TeamMailDomainDnsRecord = TeamMailDomain["requiredDnsRecords"][number];

export const getTeamMailDomainsQueryKey = (organizationId: string) =>
  ["mail-domains", organizationId] as const;

export const teamMailDomainsQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: () => rpc.mailDomains.list({ organizationId }),
    queryKey: getTeamMailDomainsQueryKey(organizationId),
    staleTime: 30_000,
  });

export const formatMailDomainStatus = (status: TeamMailDomainStatus) => {
  if (status === "verified") return "Verified";
  if (status === "pending_dns") return "Needs DNS";
  return "Check failed";
};
