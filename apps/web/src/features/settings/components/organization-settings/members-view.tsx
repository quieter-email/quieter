"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { useState } from "react";
import {
  SettingsBackButton,
  SettingsCard,
  settingsInsetDividerClass,
  settingsInsetRowClass,
  settingsRowPaddingClass,
} from "../settings-layout";
import {
  type FullOrganization,
  type OrganizationMember,
  formatCount,
  formatRoleLabel,
} from "./domain";
import { InviteMemberForm } from "./invite-member-form";
import { MemberActions } from "./member-actions";
import { PendingOrganizationInvitations } from "./pending-organization-invitations";

export const MembersView = ({
  activeMember,
  onBack,
  organization,
  permissions,
}: {
  activeMember: OrganizationMember | null;
  onBack: () => void;
  organization: FullOrganization;
  permissions: {
    canCancelInvitations: boolean;
    canInviteMembers: boolean;
    canRemoveMembers: boolean;
    canUpdateMemberRole: boolean;
  };
}) => {
  const [memberSearch, setMemberSearch] = useState("");
  const sortedMembers = organization.members.toSorted((left, right) => {
    const isLeftActive = left.userId === activeMember?.userId;
    const isRightActive = right.userId === activeMember?.userId;
    if (isLeftActive) return -1;
    if (isRightActive) return 1;
    return left.user.email.localeCompare(right.user.email);
  });
  const normalizedMemberSearch = memberSearch.trim().toLowerCase();
  const visibleMembers = normalizedMemberSearch
    ? sortedMembers.filter((member) =>
        [member.user.name ?? "", member.user.email, formatRoleLabel(member.role)].some((value) =>
          value.toLowerCase().includes(normalizedMemberSearch),
        ),
      )
    : sortedMembers;
  const showMemberSearch = sortedMembers.length > 1;

  return (
    <section className="space-y-6">
      <SettingsBackButton onClick={onBack}>{organization.name}</SettingsBackButton>

      <div>
        <h1 className="text-base font-semibold text-foreground">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCount(organization.members.length, "Member", "Members")}
        </p>
      </div>

      {permissions.canInviteMembers && (
        <SettingsCard>
          <InviteMemberForm
            canInviteMembers={permissions.canInviteMembers}
            organization={organization}
          />
        </SettingsCard>
      )}

      <SettingsCard>
        {showMemberSearch && (
          <TextField className={cn(settingsInsetRowClass, settingsInsetDividerClass, "relative")}>
            <HugeiconsIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground @md:left-6"
              icon={Search01Icon}
            />
            <TextFieldInput
              aria-label="Search members"
              chrome="ghost"
              className="h-9 pl-7"
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Search members"
              value={memberSearch}
            />
          </TextField>
        )}

        {visibleMembers.map((member) => (
          <MemberActions
            activeMember={activeMember}
            canRemoveMembers={permissions.canRemoveMembers}
            canUpdateMemberRole={permissions.canUpdateMemberRole}
            key={member.id}
            member={member}
            organizationId={organization.id}
          />
        ))}

        {visibleMembers.length === 0 && (
          <p className={cn("text-center text-sm text-muted-foreground", settingsRowPaddingClass)}>
            No members found.
          </p>
        )}
      </SettingsCard>

      <PendingOrganizationInvitations
        canCancelInvitations={permissions.canCancelInvitations}
        invitations={organization.invitations}
        organizationId={organization.id}
      />
    </section>
  );
};
