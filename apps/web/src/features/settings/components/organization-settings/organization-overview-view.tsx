"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Edit01Icon,
  Globe02Icon,
  Key02Icon,
  Logout03Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { Button } from "@quieter/ui";
import { useQuery } from "@tanstack/react-query";
import type { UserBillingOverview } from "~/features/settings/domain/billing";
import { organizationApiKeysQueryOptions } from "./api-keys";
import {
  type FullOrganization,
  type OrganizationRoleOption,
  type OrganizationSummary,
  formatCount,
  formatRoleLabel,
  hasOrganizationRole,
} from "./domain";
import { organizationMailDomainsQueryOptions } from "./mail-domains";
import { DeleteOrganizationDialog, LeaveOrganizationDialog } from "./organization-action-dialogs";
import { OrganizationBillingSettings } from "./organization-billing-settings";
import { OrganizationFormDialog } from "./organization-form-dialog";
import { OrganizationMailUsageSettings } from "./organization-mail-usage-settings";
import { MutedActionButton, SettingsRow } from "./settings-row";

export const OrganizationOverviewView = ({
  activeRole,
  billing,
  billingAccessUnknown,
  billingPending,
  canDeleteOrganization,
  canUpdateOrganization,
  canUseOrganizationApiKeys,
  canUseOrganizationDomains,
  canUseOrganizationMail,
  onBackToList,
  onOpenApiKeys,
  onOpenDomains,
  onOpenMembers,
  organization,
  pendingInvitationsCount,
  fullOrganization,
}: {
  activeRole: OrganizationRoleOption | null;
  billing: UserBillingOverview["teams"][number] | null;
  billingAccessUnknown: boolean;
  billingPending: boolean;
  canDeleteOrganization: boolean;
  canUpdateOrganization: boolean;
  canUseOrganizationApiKeys: boolean;
  canUseOrganizationDomains: boolean;
  canUseOrganizationMail: boolean;
  onBackToList: () => void;
  onOpenApiKeys: () => void;
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
  const ownerCount = fullOrganization.members.filter((member) =>
    hasOrganizationRole(member.role, "owner"),
  ).length;
  const updateOrganizationReason =
    (!canUpdateOrganization && "Only admins and owners can edit team details.") || null;
  const leaveOrganizationReason =
    (activeRole === "owner" && ownerCount <= 1 && "Assign another owner before leaving.") || null;
  const deleteOrganizationReason =
    (!canDeleteOrganization && "Only owners can delete teams.") || null;
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

  return (
    <section className="space-y-6">
      <Button
        className="w-fit text-muted-foreground hover:text-foreground"
        onClick={onBackToList}
        size="sm"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={ArrowLeft01Icon} />
        Teams
      </Button>

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-base font-semibold text-foreground">{organization.name}</h1>
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

      <div>
        <SettingsRow
          action={
            <Button onClick={onOpenMembers} size="sm" variant="outline">
              <HugeiconsIcon aria-hidden className="size-4" icon={ArrowRight01Icon} />
              Open
            </Button>
          }
          label="Members"
          value={
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon aria-hidden className="size-4" icon={UserGroupIcon} />
              {peopleSummary}
            </span>
          }
        />

        <SettingsRow
          action={
            <Button onClick={onOpenDomains} size="sm" variant="outline">
              <HugeiconsIcon aria-hidden className="size-4" icon={ArrowRight01Icon} />
              Open
            </Button>
          }
          label="Domains"
          value={
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon aria-hidden className="size-4" icon={Globe02Icon} />
              {domainsSummary}
            </span>
          }
        />

        <SettingsRow
          action={
            <Button onClick={onOpenApiKeys} size="sm" variant="outline">
              <HugeiconsIcon aria-hidden className="size-4" icon={ArrowRight01Icon} />
              Open
            </Button>
          }
          label="API keys"
          value={
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon aria-hidden className="size-4" icon={Key02Icon} />
              {apiKeysSummary}
            </span>
          }
        />

        <OrganizationBillingSettings
          billing={billing}
          billingAccessUnknown={billingAccessUnknown}
          billingPending={billingPending}
          organizationId={organization.id}
        />

        <OrganizationMailUsageSettings
          billingAccessUnknown={billingAccessUnknown}
          billingPending={billingPending}
          canManageOrganizationMailUsage={canUpdateOrganization}
          canUseOrganizationMail={canUseOrganizationMail}
          organizationId={organization.id}
        />

        <SettingsRow
          action={
            leaveOrganizationReason ? (
              <MutedActionButton
                icon={<HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />}
                label="Leave"
                reason={leaveOrganizationReason}
              />
            ) : (
              <LeaveOrganizationDialog onLeft={onBackToList} organization={fullOrganization} />
            )
          }
          label="Membership"
          value={activeRole ? formatRoleLabel(activeRole) : "Team member"}
        />

        <SettingsRow
          action={
            deleteOrganizationReason ? (
              <MutedActionButton
                buttonClassName="pointer-events-none border-destructive/25 bg-destructive/10 text-destructive/80 opacity-100 hover:bg-destructive/10 hover:text-destructive/80"
                icon={<HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />}
                label="Delete"
                reason={deleteOrganizationReason}
              />
            ) : (
              <DeleteOrganizationDialog onDeleted={onBackToList} organization={fullOrganization} />
            )
          }
          label="Delete team"
          value="Permanent"
        />
      </div>
    </section>
  );
};
