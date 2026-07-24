"use client";

import { Delete02Icon, Logout03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { authClient } from "~/lib/auth";
import { SettingsBackButton, SettingsCard } from "../settings-layout";
import {
  type FullOrganization,
  type OrganizationRoleOption,
  formatRoleLabel,
  hasOrganizationRole,
} from "./domain";
import { DeleteOrganizationDialog, LeaveOrganizationDialog } from "./organization-action-dialogs";
import { MutedActionButton, SettingsRow } from "./settings-row";

export const OrganizationDangerView = ({
  activeRole,
  canDeleteOrganization,
  fullOrganization,
  onBack,
  onLeftOrDeleted,
}: {
  activeRole: OrganizationRoleOption | null;
  canDeleteOrganization: boolean;
  fullOrganization: FullOrganization;
  onBack: () => void;
  onLeftOrDeleted: () => void;
}) => {
  const organizationCount = authClient.useListOrganizations().data?.length ?? 0;
  const ownerCount = fullOrganization.members.filter((member) =>
    hasOrganizationRole(member.role, "owner"),
  ).length;
  const leaveOrganizationReason =
    (organizationCount <= 1 && "Create another team before leaving your only team.") ||
    (activeRole === "owner" && ownerCount <= 1 && "Assign another owner before leaving.") ||
    null;
  const deleteOrganizationReason =
    (organizationCount <= 1 && "Create another team before deleting your only team.") ||
    (!canDeleteOrganization && "Only owners can delete teams.") ||
    null;

  return (
    <section className="space-y-6">
      <SettingsBackButton onClick={onBack}>{fullOrganization.name}</SettingsBackButton>

      <div>
        <h1 className="text-base font-semibold text-foreground">Danger zone</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Leave this team or delete it permanently.
        </p>
      </div>

      <SettingsCard>
        <SettingsRow
          action={
            leaveOrganizationReason ? (
              <MutedActionButton
                icon={<HugeiconsIcon aria-hidden className="size-4" icon={Logout03Icon} />}
                label="Leave"
                reason={leaveOrganizationReason}
              />
            ) : (
              <LeaveOrganizationDialog onLeft={onLeftOrDeleted} organization={fullOrganization} />
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
              <DeleteOrganizationDialog
                onDeleted={onLeftOrDeleted}
                organization={fullOrganization}
              />
            )
          }
          label="Delete team"
          value="Permanent"
        />
      </SettingsCard>
    </section>
  );
};
