"use client";

import { Delete02Icon, Logout03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  formatRoleLabel,
  hasOrganizationRole,
} from "@quieter/app/features/settings/components/organization-settings/domain";
import type {
  FullOrganization,
  OrganizationRoleOption,
} from "@quieter/app/features/settings/components/organization-settings/domain";
import {
  DeleteOrganizationDialog,
  LeaveOrganizationDialog,
} from "@quieter/app/features/settings/components/organization-settings/organization-action-dialogs";
import {
  MutedActionButton,
  SettingsRow,
} from "@quieter/app/features/settings/components/organization-settings/settings-row";
import {
  SettingsCard,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import { authClient } from "@quieter/app/lib/auth";

export const OrganizationDangerView = ({
  activeRole,
  canDeleteOrganization,
  fullOrganization,
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
    hasOrganizationRole(member.role, "owner")
  ).length;
  const leaveOrganizationReason =
    (organizationCount <= 1 &&
      "Create another team before leaving your only team.") ||
    (activeRole !== null &&
      hasOrganizationRole(activeRole, "owner") &&
      ownerCount <= 1 &&
      "Assign another owner before leaving.") ||
    null;
  const deleteOrganizationReason =
    (organizationCount <= 1 &&
      "Create another team before deleting your only team.") ||
    (!canDeleteOrganization && "Only owners can delete teams.") ||
    null;

  return (
    <SettingsSection
      description="Leave this team or delete it permanently."
      title="Membership"
    >
      <SettingsCard>
        <SettingsRow
          action={
            leaveOrganizationReason ? (
              <MutedActionButton
                icon={
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Logout03Icon}
                  />
                }
                label="Leave"
                reason={leaveOrganizationReason}
                variant="destructive"
              />
            ) : (
              <LeaveOrganizationDialog
                onLeft={onLeftOrDeleted}
                organization={fullOrganization}
              />
            )
          }
          label="Membership"
          value={activeRole ? formatRoleLabel(activeRole) : "Team member"}
        />

        <SettingsRow
          action={
            deleteOrganizationReason ? (
              <MutedActionButton
                icon={
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4"
                    icon={Delete02Icon}
                  />
                }
                label="Delete"
                reason={deleteOrganizationReason}
                variant="destructive"
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
    </SettingsSection>
  );
};
