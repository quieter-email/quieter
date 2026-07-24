"use client";

import { Delete02Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "~/lib/auth";
import { SettingsCard, SettingsSection, settingsRowPaddingClass } from "../settings-layout";
import { type FullOrganization, formatRoleLabel, getFullOrganizationQueryKey } from "./domain";
import { SettingsRow } from "./settings-row";

export const PendingOrganizationInvitations = ({
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
    <SettingsSection title="Pending invitations">
      <SettingsCard>
        {pendingInvitations.map((invitation) => {
          const isPending =
            pendingInvitationId === invitation.id && cancelInvitationMutation.isPending;

          return (
            <SettingsRow
              action={
                canCancelInvitations ? (
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
                ) : null
              }
              key={invitation.id}
              label={invitation.email}
              value={formatRoleLabel(invitation.role)}
            />
          );
        })}
        {error && (
          <p className={cn("text-sm text-destructive", settingsRowPaddingClass)} role="alert">
            {error}
          </p>
        )}
      </SettingsCard>
    </SettingsSection>
  );
};
