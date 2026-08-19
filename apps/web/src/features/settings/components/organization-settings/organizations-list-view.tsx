"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { runDetached } from "#/features/settings/components/mailboxes-settings-shared";
import { authClient } from "#/lib/auth";

import {
  SettingsCard,
  SettingsNavigationRow,
  SettingsLoadingState,
  SettingsRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "../settings-layout";
import { prefetchOrganizationSettingsDetail } from "../settings-prefetch";
import {
  formatDate,
  formatRoleLabel,
  getUserInvitationsQueryKey,
  userInvitationsQueryOptions,
} from "./domain";
import type { OrganizationSummary, UserInvitation } from "./domain";
import { OrganizationFormDialog } from "./organization-form-dialog";
import { SettingsRow } from "./settings-row";

const PendingInvitationsSection = () => {
  const sessionState = authClient.useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(
    null
  );
  const userId = sessionState.data?.user.id ?? "";
  const {
    data: userInvitations = [],
    error: userInvitationsError,
    isPending: areUserInvitationsPending,
  } = useQuery(
    userInvitationsQueryOptions(
      userId,
      (sessionState.data?.user.email ?? "") !== ""
    )
  );
  const acceptInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await authClient.organization.acceptInvitation({
        invitationId,
      });
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not accept invitation."
        );
      }
      return response;
    },
    mutationKey: ["auth", "organization", "accept-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getUserInvitationsQueryKey(userId),
      });
    },
  });
  const rejectInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await authClient.organization.rejectInvitation({
        invitationId,
      });
      if (response.error) {
        throw new Error(
          response.error.message ?? "Could not reject invitation."
        );
      }
      return response;
    },
    mutationKey: ["auth", "organization", "reject-invitation"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getUserInvitationsQueryKey(userId),
      });
    },
  });
  const invitations = userInvitations.toSorted((left, right) =>
    left.organizationName.localeCompare(right.organizationName)
  );

  const handleInvitationAction = async (
    invitation: UserInvitation,
    action: "accept" | "reject"
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
      if (mutationError instanceof Error) {
        const { message: errorMessage } = mutationError;
        setError(errorMessage);
      } else if (action === "accept") {
        setError("Could not accept invitation.");
      } else {
        setError("Could not reject invitation.");
      }
      setPendingInvitationId(null);
    }
  };

  if (areUserInvitationsPending) {
    return (
      <SettingsLoadingState className="min-h-15" label="Loading invitations" />
    );
  }

  if (userInvitationsError) {
    return (
      <p className="text-body text-destructive">
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
          (acceptInvitationMutation.isPending ||
            rejectInvitationMutation.isPending);

        return (
          <SettingsRow
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={isPending}
                  onClick={() => {
                    runDetached(async () => {
                      await handleInvitationAction(invitation, "accept");
                    });
                  }}
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
                  onClick={() => {
                    runDetached(async () => {
                      await handleInvitationAction(invitation, "reject");
                    });
                  }}
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
      {(error ?? "") === "" ? null : (
        <p
          className={cn(
            "text-body text-destructive",
            settingsSurfaceVariants({ variant: "padding" })
          )}
        >
          {error}
        </p>
      )}
    </SettingsCard>
  );
};

export const OrganizationsListView = ({
  error,
  isPending = false,
  onSelectOrganization,
  organizations,
}: {
  error?: string;
  isPending?: boolean;
  onSelectOrganization: (organizationId: string) => void;
  organizations: OrganizationSummary[];
}) => {
  const queryClient = useQueryClient();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-body font-normal text-fg">Teams</h1>
        <OrganizationFormDialog />
      </div>

      <SettingsSection title="Your teams">
        {(() => {
          if (isPending) {
            return <SettingsLoadingState label="Loading teams" />;
          }
          if ((error ?? "") !== "") {
            return <p className="text-body text-destructive">{error}</p>;
          }
          if (organizations.length > 0) {
            return (
              <SettingsRows>
                {organizations
                  .toSorted((left, right) =>
                    left.name.localeCompare(right.name)
                  )
                  .map((organization) => (
                    <SettingsNavigationRow
                      description={organization.slug}
                      key={organization.id}
                      onClick={() => {
                        onSelectOrganization(organization.id);
                      }}
                      onIntent={() => {
                        runDetached(async () => {
                          await prefetchOrganizationSettingsDetail(
                            queryClient,
                            organization.id
                          );
                        });
                      }}
                      title={organization.name}
                    />
                  ))}
              </SettingsRows>
            );
          }
          return <p className="text-body text-muted-fg">No teams yet.</p>;
        })()}
      </SettingsSection>

      <PendingInvitationsSection />
    </div>
  );
};
