"use client";

import { ApiKeysView } from "@quieter/app/features/settings/components/organization-settings/api-keys-view";
import { DivisionsView } from "@quieter/app/features/settings/components/organization-settings/divisions-view";
import {
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
} from "@quieter/app/features/settings/components/organization-settings/domain";
import type { OrganizationSummary } from "@quieter/app/features/settings/components/organization-settings/domain";
import { DomainDetailView } from "@quieter/app/features/settings/components/organization-settings/domain-detail-view";
import { DomainsView } from "@quieter/app/features/settings/components/organization-settings/domains-view";
import { MailDeliveryView } from "@quieter/app/features/settings/components/organization-settings/mail-delivery-view";
import { MailSuppressionsView } from "@quieter/app/features/settings/components/organization-settings/mail-suppressions-view";
import { MembersView } from "@quieter/app/features/settings/components/organization-settings/members-view";
import { OrganizationBillingView } from "@quieter/app/features/settings/components/organization-settings/organization-billing-view";
import { OrganizationDangerView } from "@quieter/app/features/settings/components/organization-settings/organization-danger-view";
import { OrganizationGeneralSettings } from "@quieter/app/features/settings/components/organization-settings/organization-general-settings";
import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsPageHeader,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import {
  getTeamBilling,
  userBillingQueryOptions,
} from "@quieter/app/features/settings/domain/billing";
import type { OrganizationSettingsView } from "@quieter/app/features/settings/domain/organization-settings-view";
import { useQuery } from "@tanstack/react-query";

export const OrganizationDetailView = ({
  domainId,
  onBackToList,
  onBackToOrganization,
  onOpenDomains,
  onOpenDomain,
  organization,
  userId,
  view,
}: {
  domainId: string;
  onBackToList: () => void;
  onBackToOrganization: () => void;
  onOpenDomains: () => void;
  onOpenDomain: (domainId: string) => void;
  organization: OrganizationSummary;
  userId: string;
  view: OrganizationSettingsView;
}) => {
  const {
    data: fullOrganization,
    error: fullOrganizationError,
    isError: isFullOrganizationError,
    isPending: isFullOrganizationPending,
    refetch: refetchFullOrganization,
  } = useQuery(fullOrganizationQueryOptions(organization.id));
  const {
    data: billing,
    isError: isBillingError,
    isPending: isBillingPending,
    isSuccess: isBillingSuccess,
  } = useQuery(userBillingQueryOptions());
  const activeMember =
    fullOrganization?.members.find((member) => member.userId === userId) ??
    null;
  const activeRole =
    activeMember && normalizeOrganizationRole(activeMember.role);
  const canCancelInvitations = hasOrganizationPermission(activeRole, {
    invitation: ["cancel"],
  });
  const canDeleteOrganization = hasOrganizationPermission(activeRole, {
    organization: ["delete"],
  });
  const canInviteMembers = hasOrganizationPermission(activeRole, {
    invitation: ["create"],
  });
  const canRemoveMembers = hasOrganizationPermission(activeRole, {
    member: ["delete"],
  });
  const canUpdateMemberRole = hasOrganizationPermission(activeRole, {
    member: ["update"],
  });
  const canUpdateOrganization = hasOrganizationPermission(activeRole, {
    organization: ["update"],
  });
  const teamBilling = getTeamBilling(billing, organization.id);
  const canUseTeamFeatures =
    isBillingSuccess && teamBilling?.hasAccess === true;

  if (isFullOrganizationPending) {
    return <SettingsLoadingState className="min-h-64" label="Loading team" />;
  }

  if (isFullOrganizationError) {
    return (
      <SettingsErrorState
        message={fullOrganizationError.message ?? "Could not load team."}
        onRetry={() => {
          void refetchFullOrganization();
        }}
      />
    );
  }

  if (!fullOrganization) {
    return <p className="text-body text-muted-fg">Team not found.</p>;
  }

  if (view === "members") {
    return (
      <MembersView
        activeMember={activeMember}
        permissions={{
          canCancelInvitations,
          canInviteMembers,
          canRemoveMembers,
          canUpdateMemberRole,
        }}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  if (view === "domains") {
    if (domainId) {
      return (
        <DomainDetailView
          billingAccessUnknown={isBillingError}
          billingPending={isBillingPending}
          canManageDomains={canUpdateOrganization}
          canUseOrganizationDomains={canUseTeamFeatures}
          domainId={domainId}
          onBack={onOpenDomains}
          organization={fullOrganization}
        />
      );
    }
    return (
      <DomainsView
        billingAccessUnknown={isBillingError}
        billingPending={isBillingPending}
        canManageDomains={canUpdateOrganization}
        canUseOrganizationDomains={canUseTeamFeatures}
        onBack={onBackToOrganization}
        onOpenDomain={onOpenDomain}
        organization={fullOrganization}
      />
    );
  }

  if (view === "divisions") {
    return (
      <DivisionsView
        canManageDivisions={canUpdateOrganization}
        members={fullOrganization.members}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  if (view === "api-keys") {
    return (
      <ApiKeysView
        billingAccessUnknown={isBillingError}
        billingPending={isBillingPending}
        canManageApiKeys={canUpdateOrganization}
        canUseOrganizationApiKeys={canUseTeamFeatures}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  if (view === "suppressions") {
    return (
      <MailSuppressionsView
        canViewSuppressions={canUpdateOrganization}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  if (view === "delivery") {
    return (
      <MailDeliveryView
        canManage={canUpdateOrganization}
        key={fullOrganization.id}
        onBack={onBackToOrganization}
        organization={fullOrganization}
      />
    );
  }

  if (view === "billing") {
    return (
      <OrganizationBillingView
        billing={teamBilling}
        billingAccessUnknown={isBillingError}
        billingPending={isBillingPending}
        canManageOrganizationMailUsage={canUpdateOrganization}
        canUseOrganizationMail={canUseTeamFeatures}
        onBack={onBackToOrganization}
        organizationId={organization.id}
        organizationName={fullOrganization.name}
      />
    );
  }

  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader title="General" />
      <OrganizationGeneralSettings
        key={organization.id}
        organization={organization}
        canManage={canUpdateOrganization}
      />
      <OrganizationDangerView
        activeRole={activeRole}
        canDeleteOrganization={canDeleteOrganization}
        fullOrganization={fullOrganization}
        onBack={onBackToOrganization}
        onLeftOrDeleted={onBackToList}
      />
    </div>
  );
};
