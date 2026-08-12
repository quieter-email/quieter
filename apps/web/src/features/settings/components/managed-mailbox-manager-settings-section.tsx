"use client";

import type { RouterOutputs } from "@quieter/orpc";
import type { UseQueryResult } from "@tanstack/react-query";

import type {
  ManagedMailboxDivisionGrantInput,
  ManagedMailboxGrantInput,
  ManagedMailboxToggleInput,
  ManagedMailboxUpdateInput,
  SettingsMutation,
} from "#/features/settings/components/mailbox-detail-mutation-types";
import { showMutationError } from "#/features/settings/components/mailboxes-settings-shared";
import { ManagedMailboxDetailSettings } from "#/features/settings/components/managed-mailbox-detail-settings";
import {
  SettingsCard,
  SettingsLoadingState,
} from "#/features/settings/components/settings-layout";

type ManagedMailboxDetails = RouterOutputs["mail"]["getManagedMailboxDetails"];

export const ManagedMailboxManagerSettingsSection = ({
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
  setGmailUsefulDetailsMutation,
  setManagedMailboxDivisionGrantMutation,
  setManagedMailboxGrantMutation,
  updateManagedMailboxMutation,
}: {
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
  setGmailUsefulDetailsMutation: SettingsMutation<ManagedMailboxToggleInput>;
  setManagedMailboxDivisionGrantMutation: SettingsMutation<ManagedMailboxDivisionGrantInput>;
  setManagedMailboxGrantMutation: SettingsMutation<ManagedMailboxGrantInput>;
  updateManagedMailboxMutation: SettingsMutation<ManagedMailboxUpdateInput>;
}) => {
  if (managedMailboxQuery.isPending) {
    return (
      <SettingsLoadingState
        className="min-h-48"
        label="Loading shared inbox settings"
      />
    );
  }

  if (managedMailboxQuery.data === undefined) {
    return (
      <SettingsCard className="p-6 text-sm text-destructive">
        {managedMailboxQuery.error?.message ??
          "Could not load shared inbox settings."}
      </SettingsCard>
    );
  }

  return (
    <ManagedMailboxDetailSettings
      detailManagedDivisions={detailManagedDivisions}
      detailManagedMembers={detailManagedMembers}
      details={managedMailboxQuery.data}
      emailAddress={emailAddress}
      hasAutomationAccess={hasAutomationAccess}
      includeApiMessagesSwitchId={includeApiMessagesSwitchId}
      isUpdatePending={updateManagedMailboxMutation.isPending}
      mailboxId={mailboxId}
      onAutoLabelChange={(enabled) => {
        // Optimistic; the mutation owns rollback and the failure toast.
        setGmailAutoLabelingMutation.mutate({ enabled, mailboxId });
      }}
      onDivisionGrantChange={(divisionId, role) => {
        if (role === null) {
          removeManagedMailboxDivisionGrantMutation.mutate(
            { divisionId, mailboxId },
            { onError: showMutationError("Could not remove access.") }
          );
          return;
        }
        setManagedMailboxDivisionGrantMutation.mutate(
          { divisionId, mailboxId, role },
          { onError: showMutationError("Could not update access.") }
        );
      }}
      onMemberGrantChange={(userId, role) => {
        if (role === null) {
          removeManagedMailboxGrantMutation.mutate(
            { mailboxId, userId },
            { onError: showMutationError("Could not remove access.") }
          );
          return;
        }
        setManagedMailboxGrantMutation.mutate(
          { mailboxId, role, userId },
          { onError: showMutationError("Could not update access.") }
        );
      }}
      onUpdateMailbox={(input) => {
        updateManagedMailboxMutation.mutate({ ...input, mailboxId });
      }}
      onUsefulDetailsChange={(enabled) => {
        setGmailUsefulDetailsMutation.mutate({ enabled, mailboxId });
      }}
    />
  );
};
