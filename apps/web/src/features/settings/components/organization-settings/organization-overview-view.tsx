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
import { useQuery } from "@tanstack/react-query";
import {
  formatBillingProduct,
  normalizeBillingProduct,
  type UserBillingOverview,
} from "~/features/settings/domain/billing";
import { SettingsBackButton, SettingsNavigationRow, SettingsRows } from "../settings-layout";
import { organizationApiKeysQueryOptions } from "./api-keys";
import { type FullOrganization, type OrganizationSummary, formatCount } from "./domain";
import { organizationMailDomainsQueryOptions } from "./mail-domains";
import { OrganizationFormDialog } from "./organization-form-dialog";
import { MutedActionButton } from "./settings-row";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

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
  const {
    data: apiKeys,
    isError: isApiKeysError,
    isPending: isApiKeysPending,
  } = useQuery({
    ...organizationApiKeysQueryOptions(organization.id),
    enabled: canUseOrganizationApiKeys && !!organization.id,
  });
  const {
    data: domains,
    isError: isDomainsError,
    isPending: isDomainsPending,
  } = useQuery({
    ...organizationMailDomainsQueryOptions(organization.id),
    enabled: canUseOrganizationDomains && !!organization.id,
  });
  const updateOrganizationReason =
    (!canUpdateOrganization && "Only admins and owners can edit team details.") || null;
  const peopleSummary = [
    formatCount(fullOrganization.members.length, "Member", "Members"),
    pendingInvitationsCount > 0 && formatCount(pendingInvitationsCount, "pending invitation"),
  ]
    .filter(Boolean)
    .join(", ");
  const domainsSummary = billingPending
    ? "Loading billing access…"
    : billingAccessUnknown
      ? "Could not load billing access."
      : !canUseOrganizationDomains
        ? `Requires ${BILLING_FEATURES.organizationDomains.requirementLabel}`
        : isDomainsPending
          ? "Loading domains…"
          : isDomainsError
            ? "Could not load domains."
            : formatCount(domains.domains.length, "Domain", "Domains");
  const apiKeysSummary = billingPending
    ? "Loading billing access…"
    : billingAccessUnknown
      ? "Could not load billing access."
      : !canUseOrganizationApiKeys
        ? `Requires ${BILLING_FEATURES.organizationApiKeys.requirementLabel}`
        : isApiKeysPending
          ? "Loading API keys…"
          : isApiKeysError
            ? "Could not load API keys."
            : formatCount(apiKeys.apiKeys.length, "API Key", "API Keys");
  const billingProduct = normalizeBillingProduct(billing?.product);
  const billingSummary = billingPending
    ? "Loading billing…"
    : billingAccessUnknown
      ? "Could not load billing."
      : !billing
        ? "Billing details unavailable."
        : [
            formatBillingProduct(billingProduct),
            billing.creditAmountCents != null &&
              `${moneyFormatter.format(
                (billing.usage?.remainingCreditCents ?? billing.creditAmountCents) / 100,
              )} usage balance remaining`,
          ]
            .filter(Boolean)
            .join(" — ");

  return (
    <section className="space-y-6">
      <SettingsBackButton onClick={onBackToList}>Teams</SettingsBackButton>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-base font-normal text-foreground">{organization.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{organization.slug}</p>
        </div>

        {updateOrganizationReason ? (
          <MutedActionButton
            icon={<HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />}
            label="Edit"
            reason={updateOrganizationReason}
          />
        ) : (
          <OrganizationFormDialog organization={organization} />
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
          title="Divisions"
        />
        <SettingsNavigationRow
          description={domainsSummary}
          icon={<HugeiconsIcon aria-hidden icon={Globe02Icon} />}
          onClick={onOpenDomains}
          title="Domains"
        />
        <SettingsNavigationRow
          description={apiKeysSummary}
          icon={<HugeiconsIcon aria-hidden icon={Key02Icon} />}
          onClick={onOpenApiKeys}
          title="API keys"
        />
        <SettingsNavigationRow
          description={billingSummary}
          icon={<HugeiconsIcon aria-hidden icon={Wallet02Icon} />}
          onClick={onOpenBilling}
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
