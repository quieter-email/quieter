"use client";

import {
  Alert02Icon,
  Edit01Icon,
  Globe02Icon,
  Key02Icon,
  LeftToRightListBulletIcon,
  UserGroupIcon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { runDetached } from "#/features/settings/components/mailboxes-settings-shared";
import {
  formatBillingProduct,
  normalizeBillingProduct,
} from "#/features/settings/domain/billing";
import type { UserBillingOverview } from "#/features/settings/domain/billing";

import {
  SettingsBackButton,
  SettingsNavigationRow,
  SettingsRows,
} from "../settings-layout";
import { prefetchOrganizationDivisions } from "../settings-prefetch";
import { organizationApiKeysQueryOptions } from "./api-keys";
import { formatCount } from "./domain";
import type { FullOrganization, OrganizationSummary } from "./domain";
import { organizationMailDomainsQueryOptions } from "./mail-domains";
import { OrganizationFormDialog } from "./organization-form-dialog";
import { organizationMailUsageQueryOptions } from "./organization-mail-usage-query";
import { MutedActionButton } from "./settings-row";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const getBillingAccessSummary = (
  billingPending: boolean,
  billingAccessUnknown: boolean,
  unavailableMessage: string
) => {
  if (billingPending) {
    return "Loading billing access…";
  }
  if (billingAccessUnknown) {
    return "Could not load billing access.";
  }
  return unavailableMessage;
};

const getDomainsSummary = ({
  billingAccessUnknown,
  billingPending,
  canUseOrganizationDomains,
  domainCount,
  isDomainsError,
  isDomainsPending,
}: {
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canUseOrganizationDomains: boolean;
  domainCount: number;
  isDomainsError: boolean;
  isDomainsPending: boolean;
}) => {
  if (billingPending || billingAccessUnknown) {
    return getBillingAccessSummary(billingPending, billingAccessUnknown, "");
  }
  if (!canUseOrganizationDomains) {
    return `Requires ${BILLING_FEATURES.organizationDomains.requirementLabel}`;
  }
  if (isDomainsPending) {
    return "Loading domains…";
  }
  if (isDomainsError) {
    return "Could not load domains.";
  }
  return formatCount(domainCount, "Domain", "Domains");
};

const getApiKeysSummary = ({
  apiKeyCount,
  billingAccessUnknown,
  billingPending,
  canUseOrganizationApiKeys,
  isApiKeysError,
  isApiKeysPending,
}: {
  apiKeyCount: number;
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canUseOrganizationApiKeys: boolean;
  isApiKeysError: boolean;
  isApiKeysPending: boolean;
}) => {
  if (billingPending || billingAccessUnknown) {
    return getBillingAccessSummary(billingPending, billingAccessUnknown, "");
  }
  if (!canUseOrganizationApiKeys) {
    return `Requires ${BILLING_FEATURES.organizationApiKeys.requirementLabel}`;
  }
  if (isApiKeysPending) {
    return "Loading API keys…";
  }
  if (isApiKeysError) {
    return "Could not load API keys.";
  }
  return formatCount(apiKeyCount, "API Key", "API Keys");
};

const getBillingSummary = ({
  billing,
  billingAccessUnknown,
  billingPending,
}: {
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  billingPending: boolean;
}) => {
  if (billingPending) {
    return "Loading billing…";
  }
  if (billingAccessUnknown) {
    return "Could not load billing.";
  }
  if (billing === null) {
    return "Billing details unavailable.";
  }

  const billingProduct = normalizeBillingProduct(billing.product);
  const parts = [formatBillingProduct(billingProduct)];
  if (
    billing.creditAmountCents !== null &&
    billing.creditAmountCents !== undefined
  ) {
    parts.push(
      `${moneyFormatter.format(
        (billing.usage?.remainingCreditCents ?? billing.creditAmountCents) / 100
      )} usage balance remaining`
    );
  }
  return parts.join(", ");
};

const getPeopleSummary = (
  memberCount: number,
  pendingInvitationsCount: number
) => {
  const parts = [formatCount(memberCount, "Member", "Members")];
  if (pendingInvitationsCount > 0) {
    parts.push(formatCount(pendingInvitationsCount, "pending invitation"));
  }
  return parts.join(", ");
};

export const OrganizationOverviewView = ({
  billing,
  billingAccessUnknown,
  billingPending,
  canUpdateOrganization,
  canUseOrganizationApiKeys,
  canUseOrganizationDomains,
  onBackToList,
  onOpenApiKeys,
  onOpenBilling,
  onOpenDanger,
  onOpenDivisions,
  onOpenDomains,
  onOpenMembers,
  organization,
  pendingInvitationsCount,
  fullOrganization,
}: {
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canUpdateOrganization: boolean;
  canUseOrganizationApiKeys: boolean;
  canUseOrganizationDomains: boolean;
  onBackToList: () => void;
  onOpenApiKeys: () => void;
  onOpenBilling: () => void;
  onOpenDanger: () => void;
  onOpenDivisions: () => void;
  onOpenDomains: () => void;
  onOpenMembers: () => void;
  organization: OrganizationSummary;
  pendingInvitationsCount: number;
  fullOrganization: FullOrganization;
}) => {
  const queryClient = useQueryClient();
  const {
    data: apiKeys,
    isError: isApiKeysError,
    isPending: isApiKeysPending,
  } = useQuery({
    ...organizationApiKeysQueryOptions(organization.id),
    enabled: canUseOrganizationApiKeys && organization.id.length > 0,
  });
  const {
    data: domains,
    isError: isDomainsError,
    isPending: isDomainsPending,
  } = useQuery({
    ...organizationMailDomainsQueryOptions(organization.id),
    enabled: canUseOrganizationDomains && organization.id.length > 0,
  });
  const updateOrganizationReason = canUpdateOrganization
    ? null
    : "Only admins and owners can edit team details.";
  const peopleSummary = getPeopleSummary(
    fullOrganization.members.length,
    pendingInvitationsCount
  );
  const domainsSummary = getDomainsSummary({
    billingAccessUnknown,
    billingPending,
    canUseOrganizationDomains,
    domainCount: domains?.domains.length ?? 0,
    isDomainsError,
    isDomainsPending,
  });
  const apiKeysSummary = getApiKeysSummary({
    apiKeyCount: apiKeys?.apiKeys.length ?? 0,
    billingAccessUnknown,
    billingPending,
    canUseOrganizationApiKeys,
    isApiKeysError,
    isApiKeysPending,
  });
  const billingSummary = getBillingSummary({
    billing,
    billingAccessUnknown,
    billingPending,
  });

  return (
    <section className="space-y-6">
      <SettingsBackButton onClick={onBackToList}>Teams</SettingsBackButton>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-base font-normal text-fg">{organization.name}</h1>
          <p className="mt-1 text-sm text-muted-fg">{organization.slug}</p>
        </div>

        {updateOrganizationReason === null ? (
          <OrganizationFormDialog organization={organization} />
        ) : (
          <MutedActionButton
            icon={
              <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
            }
            label="Edit"
            reason={updateOrganizationReason}
          />
        )}
      </div>

      <SettingsRows>
        <SettingsNavigationRow
          description={peopleSummary}
          icon={<HugeiconsIcon aria-hidden icon={UserGroupIcon} />}
          onClick={onOpenMembers}
          title="Members"
        />
        <SettingsNavigationRow
          description="Mailbox access groups"
          icon={<HugeiconsIcon aria-hidden icon={LeftToRightListBulletIcon} />}
          onClick={onOpenDivisions}
          onIntent={() => {
            runDetached(async () => {
              await prefetchOrganizationDivisions(queryClient, organization.id);
            });
          }}
          title="Divisions"
        />
        <SettingsNavigationRow
          description={domainsSummary}
          icon={<HugeiconsIcon aria-hidden icon={Globe02Icon} />}
          onClick={onOpenDomains}
          onIntent={() => {
            if (!canUseOrganizationDomains) {
              return;
            }
            runDetached(async () => {
              await queryClient.prefetchQuery(
                organizationMailDomainsQueryOptions(organization.id)
              );
            });
          }}
          title="Domains"
        />
        <SettingsNavigationRow
          description={apiKeysSummary}
          icon={<HugeiconsIcon aria-hidden icon={Key02Icon} />}
          onClick={onOpenApiKeys}
          onIntent={() => {
            if (!canUseOrganizationApiKeys) {
              return;
            }
            runDetached(async () => {
              await queryClient.prefetchQuery(
                organizationApiKeysQueryOptions(organization.id)
              );
            });
          }}
          title="API keys"
        />
        <SettingsNavigationRow
          description={billingSummary}
          icon={<HugeiconsIcon aria-hidden icon={Wallet02Icon} />}
          onClick={onOpenBilling}
          onIntent={() => {
            if (!canUpdateOrganization || !canUseOrganizationDomains) {
              return;
            }
            runDetached(async () => {
              await queryClient.prefetchQuery(
                organizationMailUsageQueryOptions(organization.id)
              );
            });
          }}
          title="Billing"
        />
        <SettingsNavigationRow
          description="Leave or delete this team."
          icon={<HugeiconsIcon aria-hidden icon={Alert02Icon} />}
          onClick={onOpenDanger}
          title="Danger zone"
        />
      </SettingsRows>
    </section>
  );
};
