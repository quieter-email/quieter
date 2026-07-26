"use client";

import { useQuery } from "@tanstack/react-query";
import type { OrganizationSettingsView } from "~/features/settings/domain/organization-settings-view";
import { getTeamBilling, userBillingQueryOptions } from "~/features/settings/domain/billing";
import { SettingsBackButton, SettingsErrorState, SettingsLoadingState } from "../settings-layout";
import { ApiKeysView } from "./api-keys-view";
import { DivisionsView } from "./divisions-view";
import {
  type OrganizationSummary,
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
} from "./domain";
import { DomainDetailView } from "./domain-detail-view";
import { DomainsView } from "./domains-view";
import { MembersView } from "./members-view";
import { OrganizationBillingView } from "./organization-billing-view";
import { OrganizationDangerView } from "./organization-danger-view";
import { OrganizationOverviewView } from "./organization-overview-view";

export const OrganizationDetailView = ({
  domainId,
  onBackToList,
  onBackToOrganization,
  onOpenApiKeys,
  onOpenBilling,
  onOpenDanger,
  onOpenDivisions,
  onOpenDomains,
  onOpenDomain,
  onOpenMembers,
  organization,
  userId,
  view,
}: {
  domainId: string;
  onBackToList: () => void;
  onBackToOrganization: () => void;
  onOpenApiKeys: () => void;
  onOpenBilling: () => void;
  onOpenDanger: () => void;
  onOpenDivisions: () => void;
  onOpenDomains: () => void;
  onOpenDomain: (domainId: string) => void;
  onOpenMembers: () => void;
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
  const activeMember = fullOrganization?.members.find((member) => member.userId === userId) ?? null;
  const activeRole = activeMember && normalizeOrganizationRole(activeMember.role);
  const pendingInvitations =
    fullOrganization?.invitations.filter((invitation) => invitation.status === "pending") ?? [];
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
  const canUseTeamFeatures = isBillingSuccess && teamBilling?.hasAccess === true;

  if (isFullOrganizationPending) {
    return (
      <>
        <SettingsBackButton onClick={onBackToList}>Teams</SettingsBackButton>
        <SettingsLoadingState className="min-h-64" label="Loading team" />
      </>
    );
  }

  if (isFullOrganizationError) {
    return (
      <>
        <SettingsBackButton onClick={onBackToList}>Teams</SettingsBackButton>
        <SettingsErrorState
          message={fullOrganizationError.message ?? "Could not load team."}
          onRetry={() => void refetchFullOrganization()}
        />
      </>
    );
  }

  if (!fullOrganization) {
    return (
      <>
        <SettingsBackButton onClick={onBackToList}>Teams</SettingsBackButton>
        <p className="text-sm text-muted-foreground">Team not found.</p>
      </>
    );
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

  if (view === "danger") {
    return (
      <OrganizationDangerView
        activeRole={activeRole}
        canDeleteOrganization={canDeleteOrganization}
        fullOrganization={fullOrganization}
        onBack={onBackToOrganization}
        onLeftOrDeleted={onBackToList}
      />
    );
  }

  return (
    <OrganizationOverviewView
      billing={teamBilling}
      billingAccessUnknown={isBillingError}
      billingPending={isBillingPending}
      canUpdateOrganization={canUpdateOrganization}
      canUseOrganizationApiKeys={canUseTeamFeatures}
      canUseOrganizationDomains={canUseTeamFeatures}
      fullOrganization={fullOrganization}
      onBackToList={onBackToList}
      onOpenApiKeys={onOpenApiKeys}
      onOpenBilling={onOpenBilling}
      onOpenDanger={onOpenDanger}
      onOpenDivisions={onOpenDivisions}
      onOpenDomains={onOpenDomains}
      onOpenMembers={onOpenMembers}
      organization={organization}
      pendingInvitationsCount={pendingInvitations.length}
    />
  );
};
