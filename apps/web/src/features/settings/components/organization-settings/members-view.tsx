"use client";

import { ArrowLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Separator, TextField, TextFieldInput } from "@quieter/ui";
import { useState } from "react";
import {
  type FullOrganization,
  type OrganizationMember,
  formatCount,
  formatRoleLabel,
} from "./domain";
import { InviteMemberForm } from "./invite-member-form";
import { MemberActions } from "./member-actions";
import { PendingTeamInvitations } from "./pending-team-invitations";

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

  return (
    <div className="space-y-6">
      <Button
        className="w-fit text-muted-foreground hover:text-foreground"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden className="size-4" icon={ArrowLeft01Icon} />
        {organization.name}
      </Button>

      <div>
        <h1 className="text-base font-semibold text-foreground">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCount(organization.members.length, "member")}
        </p>
      </div>

      {permissions.canInviteMembers && (
        <>
          <InviteMemberForm
            canInviteMembers={permissions.canInviteMembers}
            organization={organization}
          />
          <Separator />
        </>
      )}

      <TextField className="relative">
        <HugeiconsIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          icon={Search01Icon}
        />
        <TextFieldInput
          aria-label="Search members"
          className="pl-9"
          onChange={(event) => setMemberSearch(event.target.value)}
          placeholder="Search members"
          value={memberSearch}
        />
      </TextField>

      <div>
        {visibleMembers.map((member) => {
          return (
            <MemberActions
              activeMember={activeMember}
              canRemoveMembers={permissions.canRemoveMembers}
              canUpdateMemberRole={permissions.canUpdateMemberRole}
              key={member.id}
              member={member}
              organizationId={organization.id}
            />
          );
        })}

        {visibleMembers.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No members found.</p>
        )}
      </div>

      <PendingTeamInvitations
        canCancelInvitations={permissions.canCancelInvitations}
        invitations={organization.invitations}
        organizationId={organization.id}
      />
    </div>
  );
};
