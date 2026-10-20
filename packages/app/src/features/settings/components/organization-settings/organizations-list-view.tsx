"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { runDetached } from "@quieter/app/features/settings/components/mailboxes-settings-shared";
import {
  formatDate,
  formatRoleLabel,
  getUserInvitationsQueryKey,
  userInvitationsQueryOptions,
} from "@quieter/app/features/settings/components/organization-settings/domain";
import type {
  OrganizationSummary,
  UserInvitation,
} from "@quieter/app/features/settings/components/organization-settings/domain";
import { OrganizationFormDialog } from "@quieter/app/features/settings/components/organization-settings/organization-form-dialog";
import { SettingsRow } from "@quieter/app/features/settings/components/organization-settings/settings-row";
import {
  SettingsCard,
  SettingsNavigationRow,
  SettingsLoadingState,
  SettingsPageHeader,
  SettingsRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { prefetchOrganizationSettingsDetail } from "@quieter/app/features/settings/components/settings-prefetch";
import { authClient } from "@quieter/app/lib/auth";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Text } from "@quieter/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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
      <Text tone="destructive">
        {userInvitationsError.message ?? "Could not load invitations."}
      </Text>
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
    <div className={settingsSurfaceVariants({ variant: "page" })}>
      <SettingsPageHeader action={<OrganizationFormDialog />} title="Teams" />

      <SettingsSection title="Your teams">
        {(() => {
          if (isPending) {
            return <SettingsLoadingState label="Loading teams" />;
          }
          if ((error ?? "") !== "") {
            return <Text tone="destructive">{error}</Text>;
          }
          if (organizations.length > 0) {
            return (
              <SettingsRows>
                {organizations.map((organization) => (
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
