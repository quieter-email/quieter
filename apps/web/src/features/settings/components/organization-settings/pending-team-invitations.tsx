"use client";

import { Delete02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "~/lib/auth";
import { type FullOrganization, formatRoleLabel, getFullOrganizationQueryKey } from "./domain";

export const PendingTeamInvitations = ({
  canCancelInvitations,
  invitations,
  organizationId,
}: {
  canCancelInvitations: boolean;
  invitations: FullOrganization["invitations"];
  organizationId: string;
}) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const cancelInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await authClient.organization.cancelInvitation({ invitationId });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not cancel invitation.");
      }
      return response;
    },
    mutationKey: ["auth", "organization", organizationId, "cancel-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFullOrganizationQueryKey(organizationId),
      });
    },
  });
  const pendingInvitations = invitations
    .filter((invitation) => invitation.status === "pending")
    .sort((left, right) => left.email.localeCompare(right.email));

  if (pendingInvitations.length === 0) {
    return null;
  }

  const handleCancelInvitation = async (invitationId: string) => {
    setError(null);

    try {
      setPendingInvitationId(invitationId);
      await cancelInvitationMutation.mutateAsync(invitationId);
      setPendingInvitationId(null);
    } catch (mutationError) {
      setError((mutationError as { message?: string })?.message ?? "Could not cancel invitation.");
      setPendingInvitationId(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Pending invitations</p>

      <div className="divide-y divide-border/70">
        {pendingInvitations.map((invitation) => {
          const isPending =
            pendingInvitationId === invitation.id && cancelInvitationMutation.isPending;

          return (
            <div
              className="flex flex-col gap-3 py-3 md:flex-row md:items-center"
              key={invitation.id}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{invitation.email}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatRoleLabel(invitation.role)}
                </p>
              </div>

              {canCancelInvitations && (
                <Button
                  disabled={isPending}
                  onClick={() => void handleCancelInvitation(invitation.id)}
                  size="sm"
                  variant="outline"
                >
                  {isPending ? (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  ) : (
                    <HugeiconsIcon aria-hidden className="size-4" icon={Delete02Icon} />
                  )}
                  Cancel
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};
