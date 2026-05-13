"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import type { TeamSettingsView } from "~/features/settings/domain/team-settings-view";
import { ApiKeysView } from "./api-keys-view";
import {
  type OrganizationSummary,
  fullOrganizationQueryOptions,
  hasOrganizationPermission,
  normalizeOrganizationRole,
} from "./domain";
import { DomainsView } from "./domains-view";
import { MembersView } from "./members-view";
import { TeamOverviewView } from "./team-overview-view";

export const TeamView = ({
  onBackToList,
  onBackToTeam,
  onOpenApiKeys,
  onOpenDomains,
  onOpenMembers,
  organization,
  userId,
  view,
}: {
  onBackToList: () => void;
  onBackToTeam: () => void;
  onOpenApiKeys: () => void;
  onOpenDomains: () => void;
  onOpenMembers: () => void;
  organization: OrganizationSummary;
  userId: string;
  view: TeamSettingsView;
}) => {
  const fullOrganizationQuery = useQuery(fullOrganizationQueryOptions(organization.id));
  const fullOrganization = fullOrganizationQuery.data;
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

  if (fullOrganizationQuery.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
        Loading team…
      </div>
    );
  }

  if (fullOrganizationQuery.isError) {
    return (
      <p className="text-sm text-destructive">
        {fullOrganizationQuery.error.message ?? "Could not load team."}
      </p>
    );
  }

  if (!fullOrganization) {
    return <p className="text-sm text-muted-foreground">Team not found.</p>;
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
        onBack={onBackToTeam}
        organization={fullOrganization}
      />
    );
  }

  if (view === "domains") {
    return (
      <DomainsView
        canManageDomains={canUpdateOrganization}
        onBack={onBackToTeam}
        organization={fullOrganization}
      />
    );
  }

  if (view === "api-keys") {
    return (
      <ApiKeysView
        canManageApiKeys={canUpdateOrganization}
        onBack={onBackToTeam}
        organization={fullOrganization}
      />
    );
  }

  return (
    <TeamOverviewView
      activeRole={activeRole}
      canDeleteOrganization={canDeleteOrganization}
      canUpdateOrganization={canUpdateOrganization}
      fullOrganization={fullOrganization}
      onBackToList={onBackToList}
      onOpenApiKeys={onOpenApiKeys}
      onOpenDomains={onOpenDomains}
      onOpenMembers={onOpenMembers}
      organization={organization}
      pendingInvitationsCount={pendingInvitations.length}
    />
  );
};
