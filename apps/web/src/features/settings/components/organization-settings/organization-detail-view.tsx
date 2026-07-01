"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import type { OrganizationSettingsView } from "~/features/settings/domain/organization-settings-view";
import { getTeamBilling, userBillingQueryOptions } from "~/features/settings/domain/billing";
import { SettingsBackButton } from "../settings-layout";
import { ApiKeysView } from "./api-keys-view";
import { DivisionsView } from "./divisions-view";
import {
  type OrganizationSummary,
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
} from "./domain";
import { DomainsView } from "./domains-view";
import { MembersView } from "./members-view";
import { OrganizationOverviewView } from "./organization-overview-view";

export const OrganizationDetailView = ({
  onBackToList,
  onBackToOrganization,
  onOpenApiKeys,
  onOpenDivisions,
  onOpenDomains,
  onOpenMembers,
  organization,
  userId,
  view,
}: {
  onBackToList: () => void;
  onBackToOrganization: () => void;
  onOpenApiKeys: () => void;
  onOpenDivisions: () => void;
  onOpenDomains: () => void;
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
          Loading team…
        </div>
      </>
    );
  }

  if (isFullOrganizationError) {
    return (
      <>
        <SettingsBackButton onClick={onBackToList}>Teams</SettingsBackButton>
        <p className="text-sm text-destructive">
          {fullOrganizationError.message ?? "Could not load team."}
        </p>
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
    return (
      <DomainsView
        billingAccessUnknown={isBillingError}
        billingPending={isBillingPending}
        canManageDomains={canUpdateOrganization}
        canUseOrganizationDomains={canUseTeamFeatures}
        onBack={onBackToOrganization}
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

  return (
    <OrganizationOverviewView
      activeRole={activeRole}
      billing={teamBilling}
      billingAccessUnknown={isBillingError}
      billingPending={isBillingPending}
      canDeleteOrganization={canDeleteOrganization}
      canUpdateOrganization={canUpdateOrganization}
      canUseOrganizationApiKeys={canUseTeamFeatures}
      canUseOrganizationDomains={canUseTeamFeatures}
      canUseOrganizationMail={canUseTeamFeatures}
      fullOrganization={fullOrganization}
      onBackToList={onBackToList}
      onOpenApiKeys={onOpenApiKeys}
      onOpenDivisions={onOpenDivisions}
      onOpenDomains={onOpenDomains}
      onOpenMembers={onOpenMembers}
      organization={organization}
      pendingInvitationsCount={pendingInvitations.length}
    />
  );
};
