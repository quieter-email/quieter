"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "~/lib/auth";
import {
  SettingsCard,
  SettingsNavigationRow,
  SettingsRows,
  SettingsSection,
} from "../settings-layout";
import {
  type OrganizationSummary,
  type UserInvitation,
  formatDate,
  formatRoleLabel,
  getUserInvitationsQueryKey,
  userInvitationsQueryOptions,
} from "./domain";
import { OrganizationFormDialog } from "./organization-form-dialog";
import { SettingsRow } from "./settings-row";

const PendingInvitationsSection = () => {
  const sessionState = authClient.useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);
  const userId = sessionState.data?.user.id ?? "";
  const {
    data: userInvitations = [],
    error: userInvitationsError,
    isPending: areUserInvitationsPending,
  } = useQuery(userInvitationsQueryOptions(userId, !!sessionState.data?.user.email));
  const acceptInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await authClient.organization.acceptInvitation({ invitationId });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not accept invitation.");
      }
      return response;
    },
    mutationKey: ["auth", "organization", "accept-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getUserInvitationsQueryKey(userId) });
    },
  });
  const rejectInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await authClient.organization.rejectInvitation({ invitationId });
      if (response.error) {
        throw new Error(response.error.message ?? "Could not reject invitation.");
      }
      return response;
    },
    mutationKey: ["auth", "organization", "reject-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getUserInvitationsQueryKey(userId) });
    },
  });
  const invitations = userInvitations.toSorted((left, right) =>
    left.organizationName.localeCompare(right.organizationName),
  );

  const handleInvitationAction = async (
    invitation: UserInvitation,
    action: "accept" | "reject",
  ) => {
    setError(null);

    try {
      setPendingInvitationId(invitation.id);

      if (action === "accept") {
        await acceptInvitationMutation.mutateAsync(invitation.id);
        setPendingInvitationId(null);
        return;
      }

      await rejectInvitationMutation.mutateAsync(invitation.id);
      setPendingInvitationId(null);
    } catch (mutationError) {
      setError(
        (mutationError as { message?: string })?.message ??
          (action === "accept" ? "Could not accept invitation." : "Could not reject invitation."),
      );
      setPendingInvitationId(null);
    }
  };

  if (areUserInvitationsPending) {
    return <p className="text-sm text-muted-foreground">Loading invitations…</p>;
  }

  if (userInvitationsError) {
    return (
      <p className="text-sm text-destructive">
        {userInvitationsError.message ?? "Could not load invitations."}
      </p>
    );
  }

  if (invitations.length === 0) {
    return null;
  }

  return (
    <SettingsCard>
      {invitations.map((invitation) => {
        const isPending =
          pendingInvitationId === invitation.id &&
          (acceptInvitationMutation.isPending || rejectInvitationMutation.isPending);

        return (
          <SettingsRow
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={isPending}
                  onClick={() => void handleInvitationAction(invitation, "accept")}
                  size="sm"
                >
                  {isPending && acceptInvitationMutation.isPending && (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  )}
                  Accept
                </Button>

                <Button
                  disabled={isPending}
                  onClick={() => void handleInvitationAction(invitation, "reject")}
                  size="sm"
                  variant="outline"
                >
                  {isPending && rejectInvitationMutation.isPending && (
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4 animate-spin"
                      icon={Loading03Icon}
                    />
                  )}
                  Decline
                </Button>
              </div>
            }
            key={invitation.id}
            label={invitation.organizationName}
            value={`${formatRoleLabel(invitation.role)} role / expires ${formatDate(invitation.expiresAt)}`}
          />
        );
      })}
      {error && <p className="px-4 py-3 text-sm text-destructive md:px-6">{error}</p>}
    </SettingsCard>
  );
};

export const OrganizationsListView = ({
  onSelectOrganization,
  organizations,
}: {
  onSelectOrganization: (organizationId: string) => void;
  organizations: OrganizationSummary[];
}) => (
  <div className="space-y-8">
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-sm font-normal text-foreground">Teams</h1>
      <OrganizationFormDialog />
    </div>

    <PendingInvitationsSection />

    {organizations.length > 0 ? (
      <SettingsSection title="Your teams">
        <SettingsRows>
          {organizations
            .toSorted((left, right) => left.name.localeCompare(right.name))
            .map((organization) => (
              <SettingsNavigationRow
                description={organization.slug}
                key={organization.id}
                onClick={() => onSelectOrganization(organization.id)}
                title={organization.name}
              />
            ))}
        </SettingsRows>
      </SettingsSection>
    ) : (
      <p className="text-sm text-muted-foreground">No teams yet.</p>
    )}
  </div>
);
