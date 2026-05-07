"use client";

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Edit01Icon,
  Logout03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui";
import {
  type FullOrganization,
  type OrganizationRoleOption,
  type OrganizationSummary,
  formatCount,
  formatRoleLabel,
  hasOrganizationRole,
} from "./domain";
import { OrganizationFormDialog } from "./organization-form-dialog";
import { MutedActionButton, SettingsRow } from "./settings-row";
import { DeleteOrganizationDialog, LeaveOrganizationDialog } from "./team-action-dialogs";

export const TeamOverviewView = ({
  activeRole,
  canDeleteOrganization,
  canUpdateOrganization,
  onBackToList,
  onOpenMembers,
  organization,
  pendingInvitationsCount,
  fullOrganization,
}: {
  activeRole: OrganizationRoleOption | null;
  canDeleteOrganization: boolean;
  canUpdateOrganization: boolean;
  onBackToList: () => void;
  onOpenMembers: () => void;
  organization: OrganizationSummary;
  pendingInvitationsCount: number;
  fullOrganization: FullOrganization;
}) => {
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
    formatCount(fullOrganization.members.length, "member"),
    pendingInvitationsCount > 0 && formatCount(pendingInvitationsCount, "pending invitation"),
  ]
    .filter(Boolean)
    .join(", ");

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
          value={peopleSummary}
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
