"use client";

import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { cn } from "@quieter/ui/cn";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  SettingsBackButton,
  SettingsLoadingState,
  SettingsNavigationRow,
  SettingsRows,
  settingsSurfaceVariants,
} from "../settings-layout";
import { BillingAccessNotice } from "./billing-access-notice";
import { formatCount } from "./domain";
import type { FullOrganization } from "./domain";
import {
  formatMailDomainStatus,
  organizationMailDomainsQueryOptions,
  resolveMailDomainVerified,
} from "./mail-domains";
import type { OrganizationMailDomain } from "./mail-domains";
import { RegisterDomainDialog } from "./register-domain-dialog";
import { MutedActionButton } from "./settings-row";

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
    <div className="@container space-y-6">
      <SettingsBackButton onClick={onBack}>
        {organization.name}
      </SettingsBackButton>

      <div className="flex flex-col gap-3 @md:flex-row @md:items-start @md:justify-between">
        <div>
          <h1 className="text-body-lg font-semibold text-fg">Domains</h1>
          <p className="mt-1 text-body text-muted-fg">
            {formatCount(domains.length, "Domain", "Domains")}
          </p>
        </div>

        {manageDomainsReason === null ? (
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
        )}
      </div>

      {isSendingPaused && domains.length > 0 && (
        <BillingAccessNotice organizationId={organization.id} />
      )}
      {domainsContent}
    </div>
  );
};
