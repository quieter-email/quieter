import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export type OrganizationMailDomain = RouterOutputs["mailDomains"]["list"]["domains"][number];
export type OrganizationMailDomainStatus = OrganizationMailDomain["status"];
export type OrganizationMailDomainDnsRecord = OrganizationMailDomain["requiredDnsRecords"][number];
export type OrganizationMailDomainDetail = RouterOutputs["mailDomains"]["get"];

export const getOrganizationMailDomainsQueryKey = (organizationId: string) =>
  ["mail-domains", organizationId] as const;

export const organizationMailDomainsQueryOptions = (organizationId: string) =>
  queryOptions({
    queryFn: () => rpc.mailDomains.list({ organizationId }),
    queryKey: getOrganizationMailDomainsQueryKey(organizationId),
    staleTime: 30_000,
  });

export const getOrganizationMailDomainQueryKey = (organizationId: string, domainId: string) =>
  ["mail-domains", organizationId, domainId] as const;

export const getOrganizationDomainConnectQueryKey = (organizationId: string, domainId: string) =>
  ["mail-domains", organizationId, domainId, "domain-connect"] as const;

export const organizationMailDomainQueryOptions = (organizationId: string, domainId: string) =>
  queryOptions({
    queryFn: () => rpc.mailDomains.get({ domainId, organizationId }),
    queryKey: getOrganizationMailDomainQueryKey(organizationId, domainId),
    staleTime: 15_000,
  });

export const organizationDomainConnectQueryOptions = (organizationId: string, domainId: string) =>
  queryOptions({
    queryFn: () =>
      rpc.mailDomains.getDomainConnectAvailability({
        domainId,
        organizationId,
      }),
    queryKey: getOrganizationDomainConnectQueryKey(organizationId, domainId),
    staleTime: 60_000,
  });

export const formatMailDomainStatus = (status: OrganizationMailDomainStatus) => {
  if (status === "verified") return "Verified";
  if (status === "pending_dns") return "Needs DNS";
  return "Check failed";
};

export const isProviderLagCheck = (purpose: string) =>
  purpose === "ses_identity" || purpose === "ses_mail_from";

export const isOptionalDnsPurpose = (purpose: string) => purpose === "dmarc";

/** Required DNS (+ inbound routing) counts as verified; DMARC and provider sending can lag. */
export const resolveMailDomainVerified = (domain: {
  lastCheckResult: OrganizationMailDomain["lastCheckResult"];
  requiredDnsRecords: OrganizationMailDomain["requiredDnsRecords"];
  status: OrganizationMailDomainStatus;
}) => {
  if (domain.status === "verified") return true;

  const requiredRecords = domain.requiredDnsRecords.filter(
    (record) => record.required && !isOptionalDnsPurpose(record.purpose),
  );
  if (requiredRecords.length === 0) return false;

  const checks = domain.lastCheckResult?.checks ?? [];
  const requiredDnsReady = requiredRecords.every((record) =>
    checks.some(
      (check) => check.recordName === record.name && check.purpose === record.purpose && check.ok,
    ),
  );
  if (!requiredDnsReady) return false;

  return !checks.some(
    (check) =>
      !check.ok && !isProviderLagCheck(check.purpose) && !isOptionalDnsPurpose(check.purpose),
  );
};
