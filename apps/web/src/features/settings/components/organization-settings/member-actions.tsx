"use client";

import { Loading03Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@quieter/ui/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "~/lib/auth";
import { settingsInsetRowClass, settingsRowPaddingClass } from "../settings-layout";
import {
  type OrganizationMember,
  type OrganizationRoleOption,
  formatRoleLabel,
  getFullOrganizationQueryKey,
  hasOrganizationRole,
  organizationRoleOptions,
} from "./domain";

export const MemberActions = ({
  activeMember,
  canRemoveMembers,
  canUpdateMemberRole,
  member,
  organizationId,
}: {
  activeMember: OrganizationMember | null;
  canRemoveMembers: boolean;
  canUpdateMemberRole: boolean;
  member: OrganizationMember;
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const removeMemberMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.organization.removeMember({
        memberIdOrEmail: member.id,
        organizationId,
      });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not remove member.");
      }
      return response;
    },
    mutationKey: ["auth", "organization", organizationId, "remove-member"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organizationId),
      });
    },
  });
  const updateMemberRoleMutation = useMutation({
    mutationFn: async (role: OrganizationRoleOption) => {
      const response = await authClient.organization.updateMemberRole({
        memberId: member.id,
        organizationId,
        role,
      });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not update role.");
      }
      return response;
    },
    mutationKey: ["auth", "organization", organizationId, "update-member-role"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organizationId),
      });
    },
  });
  const isActiveMember = member.userId === activeMember?.userId;
  const isPending = removeMemberMutation.isPending || updateMemberRoleMutation.isPending;
  const unavailableReason = isActiveMember ? "Unavailable for yourself" : "No permission";
  const getRoleDisabledReason = (role: OrganizationRoleOption) =>
    hasOrganizationRole(member.role, role) ? "Current role" : unavailableReason;

  const handleRemoveMember = async () => {
    setError(null);

    try {
      await removeMemberMutation.mutateAsync();
    } catch (mutationError) {
      setError((mutationError as { message?: string })?.message ?? "Could not remove member.");
    }
  };

  const handleUpdateRole = async (role: OrganizationRoleOption) => {
    setError(null);

    try {
      await updateMemberRoleMutation.mutateAsync(role);
    } catch (mutationError) {
      setError((mutationError as { message?: string })?.message ?? "Could not update role.");
    }
  };

  return (
    <div className="space-y-1">
      <div className={cn(settingsInsetRowClass, "gap-3")}>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium text-foreground">
            {member.user.name || member.user.email}
          </p>
          <p className="mt-1 truncate text-sm text-muted-foreground">{member.user.email}</p>
        </div>

        <p className="shrink-0 text-sm text-muted-foreground">
          {formatRoleLabel(member.role)}
          {isActiveMember ? " / You" : ""}
        </p>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`Open actions for ${member.user.name || member.user.email}`}
                disabled={isPending}
                size="icon-sm"
                variant="ghost"
              />
            }
            onClick={() => setError(null)}
          >
            {isPending ? (
              <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
            ) : (
              <HugeiconsIcon aria-hidden className="size-4" icon={MoreVerticalIcon} />
            )}
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            {organizationRoleOptions.map((role) => {
              const isDisabled =
                isActiveMember || !canUpdateMemberRole || hasOrganizationRole(member.role, role);
              const item = (
                <DropdownMenuItem
                  closeOnSelect={!isDisabled}
                  disabled={isDisabled}
                  onSelect={() => {
                    if (!isDisabled) {
                      void handleUpdateRole(role);
                    }
                  }}
                >
                  Make {formatRoleLabel(role)}
                </DropdownMenuItem>
              );

              return isDisabled ? (
                <Tooltip key={role}>
                  <TooltipTrigger className="block" render={<div />}>
                    {item}
                  </TooltipTrigger>
                  <TooltipContent side="left">{getRoleDisabledReason(role)}</TooltipContent>
                </Tooltip>
              ) : (
                <div key={role}>{item}</div>
              );
            })}

            {isActiveMember || !canRemoveMembers ? (
              <Tooltip>
                <TooltipTrigger className="block" render={<div />}>
                  <DropdownMenuItem className="text-destructive" closeOnSelect={false} disabled>
                    Remove
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">{unavailableReason}</TooltipContent>
              </Tooltip>
            ) : (
              <DropdownMenuItem
                className="text-destructive"
                closeOnSelect
                onSelect={() => void handleRemoveMember()}
              >
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && (
        <p className={cn("text-sm text-destructive", settingsRowPaddingClass)} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
