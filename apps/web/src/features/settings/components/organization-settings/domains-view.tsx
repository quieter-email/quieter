"use client";

import { Globe02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { cn } from "@quieter/ui/cn";
import { useQuery } from "@tanstack/react-query";
import {
  SettingsBackButton,
  SettingsNavigationRow,
  SettingsRows,
  settingsRowPaddingClass,
} from "../settings-layout";
import { formatCount, type FullOrganization } from "./domain";
import { formatMailDomainStatus, organizationMailDomainsQueryOptions } from "./mail-domains";
import { RegisterDomainDialog } from "./register-domain-dialog";
import { MutedActionButton } from "./settings-row";

export const DomainsView = ({
  billingAccessUnknown,
  billingPending,
  canManageDomains,
  canUseOrganizationDomains,
  onBack,
  onOpenDomain,
  organization,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageDomains: boolean;
  canUseOrganizationDomains: boolean;
  onBack: () => void;
  onOpenDomain: (domainId: string) => void;
  organization: FullOrganization;
}) => {
  const {
    data: domainsData,
    error: domainsError,
    isError: isDomainsError,
    isPending: isDomainsPending,
  } = useQuery(organizationMailDomainsQueryOptions(organization.id));
  const domains = domainsData?.domains ?? [];
  const manageDomainsReason =
    (billingPending && "Loading billing access…") ||
    (billingAccessUnknown && "Could not load billing access.") ||
    (!canUseOrganizationDomains &&
      `Registering domains requires ${BILLING_FEATURES.organizationDomains.requirementLabel} billing.`) ||
    (!canManageDomains && "Only admins and owners can register team domains.") ||
    null;

  return (
    <div className="@container space-y-6">
      <SettingsBackButton onClick={onBack}>{organization.name}</SettingsBackButton>

      <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">Domains</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCount(domains.length, "Domain", "Domains")}
          </p>
        </div>

        {manageDomainsReason ? (
          <MutedActionButton
            icon={<HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />}
            label="Register"
            reason={manageDomainsReason}
          />
        ) : (
          <RegisterDomainDialog
            onCreated={(domainId) => onOpenDomain(domainId)}
            organizationId={organization.id}
          />
        )}
      </div>

      {isDomainsPending ? (
        <div
          className={cn(
            "flex items-center gap-2 text-sm text-muted-foreground",
            settingsRowPaddingClass,
          )}
        >
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          Loading domains…
        </div>
      ) : isDomainsError ? (
        <p className={cn("text-sm text-destructive", settingsRowPaddingClass)}>
          {domainsError?.message ?? "Could not load domains."}
        </p>
      ) : domains.length > 0 ? (
        <SettingsRows>
          {domains.map((domain) => (
            <SettingsNavigationRow
              description={
                domain.mode === "send_only" ? "Outbound mail only" : "Outbound and incoming mail"
              }
              key={domain.id}
              meta={formatMailDomainStatus(domain.status)}
              onClick={() => onOpenDomain(domain.id)}
              title={domain.domain}
            />
          ))}
        </SettingsRows>
      ) : (
        <p className={cn("text-center text-sm text-muted-foreground", settingsRowPaddingClass)}>
          No domains registered.
        </p>
      )}
    </div>
  );
};
