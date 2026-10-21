"use client";

import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BillingAccessNotice } from "@quieter/app/features/settings/components/organization-settings/billing-access-notice";
import { formatCount } from "@quieter/app/features/settings/components/organization-settings/domain";
import type { FullOrganization } from "@quieter/app/features/settings/components/organization-settings/domain";
import {
  formatMailDomainStatus,
  organizationMailDomainsQueryOptions,
  resolveMailDomainVerified,
} from "@quieter/app/features/settings/components/organization-settings/mail-domains";
import type { OrganizationMailDomain } from "@quieter/app/features/settings/components/organization-settings/mail-domains";
import { RegisterDomainDialog } from "@quieter/app/features/settings/components/organization-settings/register-domain-dialog";
import { MutedActionButton } from "@quieter/app/features/settings/components/organization-settings/settings-row";
import {
  SettingsLoadingState,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { cn } from "@quieter/ui/cn";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getManageDomainsReason = ({
  billingAccessUnknown,
  billingPending,
  canManageDomains,
  canUseOrganizationDomains,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canManageDomains: boolean;
  canUseOrganizationDomains: boolean;
}) => {
  if (billingPending) {
    return "Loading billing access…";
  }
  if (billingAccessUnknown) {
    return "Could not load billing access.";
  }
  if (!canUseOrganizationDomains) {
    return `Registering domains requires ${BILLING_FEATURES.organizationDomains.requirementLabel} billing.`;
  }
  if (!canManageDomains) {
    return "Only admins and owners can register team domains.";
  }
  return null;
};

const DomainsList = ({
  domains,
  isSendingPaused,
  onOpenDomain,
}: {
  domains: OrganizationMailDomain[];
  isSendingPaused: boolean;
  onOpenDomain: (domainId: string) => void;
}) => (
  <SettingsRows>
    {domains.map((domain) => {
      let status = resolveMailDomainVerified(domain)
        ? "Verified"
        : formatMailDomainStatus(domain.status);
      if (isSendingPaused) {
        status = "Sending paused";
      }
      return (
        <SettingsNavigationRow
          description={
            domain.mode === "send_only"
              ? "Outbound mail only"
              : "Outbound and incoming mail"
          }
          key={domain.id}
          meta={status}
          onClick={() => {
            onOpenDomain(domain.id);
          }}
          title={domain.domain}
        />
      );
    })}
  </SettingsRows>
);

export const DomainsView = ({
  billingAccessUnknown,
  billingPending,
  canManageDomains,
  canUseOrganizationDomains,
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
  const isSendingPaused =
    !billingPending && !billingAccessUnknown && !canUseOrganizationDomains;
  const domains = domainsData?.domains ?? [];
  const manageDomainsReason = getManageDomainsReason({
    billingAccessUnknown,
    billingPending,
    canManageDomains,
    canUseOrganizationDomains,
  });
  let domainsContent: ReactNode;
  if (isDomainsPending) {
    domainsContent = <SettingsLoadingState label="Loading domains" />;
  } else if (isDomainsError) {
    domainsContent = (
      <p
        className={cn(
          "text-body text-destructive",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        {domainsError?.message ?? "Could not load domains."}
      </p>
    );
  } else if (domains.length > 0) {
    domainsContent = (
      <DomainsList
        domains={domains}
        isSendingPaused={isSendingPaused}
        onOpenDomain={onOpenDomain}
      />
    );
  } else {
    domainsContent = (
      <p
        className={cn(
          "text-center text-body text-muted-fg",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        No domains registered.
      </p>
    );
  }

  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader
        action={
          manageDomainsReason === null ? (
            <RegisterDomainDialog
              onCreated={(domainId) => {
                onOpenDomain(domainId);
              }}
              organizationId={organization.id}
            />
          ) : (
            <MutedActionButton
              icon={
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Globe02Icon}
                />
              }
              label="Register"
              reason={manageDomainsReason}
            />
          )
        }
        title="Domains"
      >
        {formatCount(domains.length, "Domain", "Domains")}
      </SettingsPageHeader>

      {isSendingPaused && domains.length > 0 && (
        <BillingAccessNotice organizationId={organization.id} />
      )}
      {domainsContent}
    </div>
  );
};
