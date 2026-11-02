"use client";

import type {
  ManagedMailboxAccessModeInput,
  ManagedMailboxDivisionGrantInput,
  ManagedMailboxGrantInput,
  ManagedMailboxToggleInput,
  ManagedMailboxUpdateInput,
  SettingsMutation,
} from "@quieter/app/features/settings/components/mailbox-detail-mutation-types";
import { ManagedMailboxDetailSettings } from "@quieter/app/features/settings/components/managed-mailbox-detail-settings";
import {
  SettingsCard,
  settingsSurfaceVariants,
  SettingsLoadingState,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import type { RouterOutputs } from "@quieter/orpc";
import { cn } from "@quieter/ui/cn";
import type { UseQueryResult } from "@tanstack/react-query";

type ManagedMailboxDetails = RouterOutputs["mail"]["getManagedMailboxDetails"];

export const ManagedMailboxManagerSettingsSection = ({
  canMakePrivate,
  detailManagedDivisions,
  detailManagedMembers,
  emailAddress,
  hasAutomationAccess,
  includeApiMessagesSwitchId,
  mailboxId,
  managedMailboxQuery,
  removeManagedMailboxDivisionGrantMutation,
  removeManagedMailboxGrantMutation,
  setGmailAutoLabelingMutation,
  setManagedMailboxAccessModeMutation,
  setManagedMailboxDivisionGrantMutation,
  setManagedMailboxGrantMutation,
  updateManagedMailboxMutation,
}: {
  canMakePrivate: boolean;
  detailManagedDivisions: { id: string; name: string }[];
  detailManagedMembers: {
    id: string;
    user: { email: string; name: string | null };
    userId: string;
  }[];
  emailAddress: string;
  hasAutomationAccess: boolean;
  includeApiMessagesSwitchId: string;
  mailboxId: string;
  managedMailboxQuery: Pick<
    UseQueryResult<ManagedMailboxDetails>,
    "data" | "error" | "isPending"
  >;
  removeManagedMailboxDivisionGrantMutation: SettingsMutation<{
    divisionId: string;
    mailboxId: string;
  }>;
  removeManagedMailboxGrantMutation: SettingsMutation<{
    mailboxId: string;
    userId: string;
  }>;
  setGmailAutoLabelingMutation: SettingsMutation<ManagedMailboxToggleInput>;
  setManagedMailboxAccessModeMutation: SettingsMutation<ManagedMailboxAccessModeInput>;
  setManagedMailboxDivisionGrantMutation: SettingsMutation<ManagedMailboxDivisionGrantInput>;
  setManagedMailboxGrantMutation: SettingsMutation<ManagedMailboxGrantInput>;
  updateManagedMailboxMutation: SettingsMutation<ManagedMailboxUpdateInput>;
}) => {
  if (managedMailboxQuery.isPending) {
    return (
      <SettingsLoadingState
        className="min-h-48"
        label="Loading inbox settings"
      />
    );
  }

  if (managedMailboxQuery.data === undefined) {
    return (
      <SettingsCard
        className={cn(
          settingsSurfaceVariants({ variant: "body" }),
          "text-body text-destructive"
        )}
      >
        {managedMailboxQuery.error?.message ?? "Could not load inbox settings."}
      </SettingsCard>
    );
  }

  return (
    <ManagedMailboxDetailSettings
      canMakePrivate={canMakePrivate}
      detailManagedDivisions={detailManagedDivisions}
      detailManagedMembers={detailManagedMembers}
      details={managedMailboxQuery.data}
      emailAddress={emailAddress}
      hasAutomationAccess={hasAutomationAccess}
      includeApiMessagesSwitchId={includeApiMessagesSwitchId}
      isAccessModePending={setManagedMailboxAccessModeMutation.isPending}
      isUpdatePending={updateManagedMailboxMutation.isPending}
      mailboxId={mailboxId}
      onAccessModeChange={(input) => {
        setManagedMailboxAccessModeMutation.mutate({
          ...input,
          mailboxId,
        });
      }}
      onAutoLabelChange={(enabled) => {
        // Optimistic; the mutation owns rollback and the failure toast.
        setGmailAutoLabelingMutation.mutate({ enabled, mailboxId });
      }}
      onDivisionGrantChange={(divisionId, role) => {
        if (role === null) {
          removeManagedMailboxDivisionGrantMutation.mutate(
            { divisionId, mailboxId },
            {
              onError: (error) => {
                toastError(error, {
                  boundary: "mailbox-settings",
                  fallback: "Could not remove access.",
                });
              },
            }
          );
          return;
        }
        setManagedMailboxDivisionGrantMutation.mutate(
          { divisionId, mailboxId, role },
          {
            onError: (error) => {
              toastError(error, {
                boundary: "mailbox-settings",
                fallback: "Could not update access.",
              });
            },
          }
        );
      }}
      onMemberGrantChange={(userId, role) => {
        if (role === null) {
          removeManagedMailboxGrantMutation.mutate(
            { mailboxId, userId },
            {
              onError: (error) => {
                toastError(error, {
                  boundary: "mailbox-settings",
                  fallback: "Could not remove access.",
                });
              },
            }
          );
          return;
        }
        setManagedMailboxGrantMutation.mutate(
          { mailboxId, role, userId },
          {
            onError: (error) => {
              toastError(error, {
                boundary: "mailbox-settings",
                fallback: "Could not update access.",
              });
            },
          }
        );
      }}
      onUpdateMailbox={(input, onSettled) => {
        updateManagedMailboxMutation.mutate(
          { ...input, mailboxId },
          { onSettled }
        );
      }}
    />
  );
};
