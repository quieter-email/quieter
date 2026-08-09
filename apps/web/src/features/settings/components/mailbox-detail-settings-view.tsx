"use client";

import { Button } from "@quieter/ui/button";
import { useNavigate } from "@tanstack/react-router";

import { asSettingsMutation } from "#/features/settings/components/mailbox-detail-mutation-types";
import { MailboxDetailSettingsContent } from "#/features/settings/components/mailbox-detail-settings-content";
import { runDetached } from "#/features/settings/components/mailboxes-settings-shared";
import {
  SettingsCard,
  SettingsLoadingState,
  SettingsPageHeader,
} from "#/features/settings/components/settings-layout";
import { useMailboxDetailViewState } from "#/features/settings/components/use-mailbox-detail-view-state";

export const MailboxDetailSettingsView = ({
  mailboxId,
}: {
  mailboxId: string;
}) => {
  const navigate = useNavigate({ from: "/settings" });
  const {
    areMailboxesPending,
    defaultMailboxId,
    detailGroup,
    detailManagedDivisions,
    detailManagedMembers,
    hasAutomationAccess,
    managedMailboxQuery,
    mutations,
    organizations,
    placementItems,
    selectedMailbox,
  } = useMailboxDetailViewState(mailboxId);

  if (areMailboxesPending) {
    return (
      <SettingsLoadingState className="min-h-64" label="Loading mailbox" />
    );
  }

  if (selectedMailbox === null) {
    return (
      <div className="space-y-8">
        <SettingsPageHeader title="Mailbox unavailable">
          This mailbox is no longer available to your account.
        </SettingsPageHeader>
        <SettingsCard className="p-6">
          <Button
            onClick={() => {
              runDetached(async () => {
                await navigate({
                  replace: true,
                  search: (previous) => ({ ...previous, mailboxId: "" }),
                  to: ".",
                });
              });
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            View mailboxes
          </Button>
        </SettingsCard>
      </div>
    );
  }

  return (
    <MailboxDetailSettingsContent
      defaultMailboxId={defaultMailboxId}
      detailGroupName={detailGroup?.name}
      detailManagedDivisions={detailManagedDivisions}
      detailManagedMembers={detailManagedMembers}
      disconnectMailboxMutation={asSettingsMutation(
        mutations.disconnectMailboxMutation
      )}
      hasAutomationAccess={hasAutomationAccess}
      isStartingGmail={mutations.isStartingGmail}
      managedMailboxQuery={managedMailboxQuery}
      mailbox={selectedMailbox}
      moveGmailMailboxMutation={asSettingsMutation(
        mutations.moveGmailMailboxMutation
      )}
      onSetDefaultMailbox={(nextMailboxId) => {
        mutations.setDefaultMailbox(nextMailboxId, defaultMailboxId);
      }}
      onStartGmailConnection={async (input) => {
        await mutations.startGmailConnection({ ...input, organizations });
      }}
      organizations={organizations}
      placementItems={placementItems}
      removeManagedMailboxDivisionGrantMutation={asSettingsMutation(
        mutations.removeManagedMailboxDivisionGrantMutation
      )}
      removeManagedMailboxGrantMutation={asSettingsMutation(
        mutations.removeManagedMailboxGrantMutation
      )}
      setDefaultMailboxMutation={asSettingsMutation(
        mutations.setDefaultMailboxMutation
      )}
      setGmailAutoLabelingMutation={asSettingsMutation(
        mutations.setGmailAutoLabelingMutation
      )}
      setGmailUsefulDetailsMutation={asSettingsMutation(
        mutations.setGmailUsefulDetailsMutation
      )}
      setManagedMailboxDivisionGrantMutation={asSettingsMutation(
        mutations.setManagedMailboxDivisionGrantMutation
      )}
      setManagedMailboxGrantMutation={asSettingsMutation(
        mutations.setManagedMailboxGrantMutation
      )}
      updateManagedMailboxMutation={asSettingsMutation(
        mutations.updateManagedMailboxMutation
      )}
    />
  );
};
