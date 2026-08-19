"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { useNavigate } from "@tanstack/react-router";

import { GmailMailboxDetailSections } from "#/features/settings/components/gmail-mailbox-detail-sections";
import { GmailMailboxNameSettings } from "#/features/settings/components/gmail-mailbox-name-settings";
import { MailboxDetailGeneralSection } from "#/features/settings/components/mailbox-detail-general-section";
import type {
  ManagedMailboxDivisionGrantInput,
  ManagedMailboxGrantInput,
  ManagedMailboxToggleInput,
  ManagedMailboxUpdateInput,
  SettingsMutation,
} from "#/features/settings/components/mailbox-detail-mutation-types";
import { MailboxSignatureSettings } from "#/features/settings/components/mailbox-signature-settings";
import {
  getMailboxDisplayTitle,
  hasTrimmedDisplayName,
  runDetached,
  showMutationError,
} from "#/features/settings/components/mailboxes-settings-shared";
import { ManagedMailboxManagerSettingsSection } from "#/features/settings/components/managed-mailbox-manager-settings-section";
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsSection,
} from "#/features/settings/components/settings-layout";

type Mailbox =
  RouterOutputs["mail"]["listMailboxes"]["groups"][number]["mailboxes"][number];

type ManagedMailboxQuery = {
  data: RouterOutputs["mail"]["getManagedMailboxDetails"] | undefined;
  error: Error | null;
  isPending: boolean;
};

export const MailboxDetailSettingsContent = ({
  defaultMailboxId,
  detailGroupName,
  detailManagedDivisions,
  detailManagedMembers,
  disconnectMailboxMutation,
  hasAutomationAccess,
  isStartingGmail,
  managedMailboxQuery,
  mailbox,
  moveGmailMailboxMutation,
  onSetDefaultMailbox,
  onStartGmailConnection,
  organizations,
  placementItems,
  removeManagedMailboxDivisionGrantMutation,
  removeManagedMailboxGrantMutation,
  setDefaultMailboxMutation,
  setGmailAutoLabelingMutation,
  setGmailUsefulDetailsMutation,
  setManagedMailboxDivisionGrantMutation,
  setManagedMailboxGrantMutation,
  updateManagedMailboxMutation,
}: {
  defaultMailboxId: string | null;
  detailGroupName: string | undefined;
  detailManagedDivisions: { id: string; name: string }[];
  detailManagedMembers: {
    id: string;
    user: { email: string; name: string | null };
    userId: string;
  }[];
  disconnectMailboxMutation: SettingsMutation<{ mailboxId: string }>;
  hasAutomationAccess: boolean;
  isStartingGmail: boolean;
  managedMailboxQuery: ManagedMailboxQuery;
  mailbox: Mailbox;
  moveGmailMailboxMutation: SettingsMutation<{
    mailboxId: string;
    organizationId: string;
  }>;
  onSetDefaultMailbox: (mailboxId: string) => void;
  onStartGmailConnection: (input: {
    mailboxId: string;
    organizationId: string;
  }) => Promise<void>;
  organizations: { id: string; name: string }[];
  placementItems: { label: string; value: string }[];
  removeManagedMailboxDivisionGrantMutation: SettingsMutation<{
    divisionId: string;
    mailboxId: string;
  }>;
  removeManagedMailboxGrantMutation: SettingsMutation<{
    mailboxId: string;
    userId: string;
  }>;
  setDefaultMailboxMutation: SettingsMutation<{ mailboxId: string | null }>;
  setGmailAutoLabelingMutation: SettingsMutation<ManagedMailboxToggleInput>;
  setGmailUsefulDetailsMutation: SettingsMutation<ManagedMailboxToggleInput>;
  setManagedMailboxDivisionGrantMutation: SettingsMutation<ManagedMailboxDivisionGrantInput>;
  setManagedMailboxGrantMutation: SettingsMutation<ManagedMailboxGrantInput>;
  updateManagedMailboxMutation: SettingsMutation<ManagedMailboxUpdateInput>;
}) => {
  const navigate = useNavigate({ from: "/settings" });
  const title = getMailboxDisplayTitle(
    mailbox.displayName,
    mailbox.emailAddress
  );
  const usefulDetailsSwitchId = `gmail-useful-details-${mailbox.id}`;
  const autoLabelSwitchId = `gmail-auto-label-${mailbox.id}`;
  const includeApiMessagesSwitchId = `managed-api-messages-${mailbox.id}`;
  const isGmail = mailbox.provider === "gmail";
  const isManagedManager =
    mailbox.provider === "managed" && mailbox.grantRole === "manager";
  const isManagedNonManager =
    mailbox.provider === "managed" && mailbox.grantRole !== "manager";
  const isApi = mailbox.provider === "api";

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={title}>
        {hasTrimmedDisplayName(mailbox.displayName) && (
          <span>{mailbox.emailAddress}, </span>
        )}
        {detailGroupName}
      </SettingsPageHeader>

      <MailboxDetailGeneralSection
        defaultMailboxId={defaultMailboxId}
        isDefaultMailboxPending={setDefaultMailboxMutation.isPending}
        isMovePending={moveGmailMailboxMutation.isPending}
        isStartingGmail={isStartingGmail}
        mailbox={mailbox}
        moveGmailMailboxMutation={moveGmailMailboxMutation}
        onSetDefaultMailbox={onSetDefaultMailbox}
        onStartGmailConnection={onStartGmailConnection}
        organizations={organizations}
        placementItems={placementItems}
      />

      {isGmail && (
        <GmailMailboxNameSettings key={mailbox.id} mailbox={mailbox} />
      )}

      {(isGmail || isManagedManager) && (
        <MailboxSignatureSettings key={mailbox.id} mailbox={mailbox} />
      )}

      {isGmail && (
        <GmailMailboxDetailSections
          autoLabelEnabled={mailbox.autoLabelEnabled}
          autoLabelSwitchId={autoLabelSwitchId}
          connectionStatus={mailbox.connectionStatus}
          disconnectPending={disconnectMailboxMutation.isPending}
          emailAddress={mailbox.emailAddress}
          hasAutomationAccess={hasAutomationAccess}
          onAutoLabelChange={(enabled) => {
            // Optimistic; the mutation owns rollback and the failure toast.
            setGmailAutoLabelingMutation.mutate({
              enabled,
              mailboxId: mailbox.id,
            });
          }}
          onDisconnect={() => {
            disconnectMailboxMutation.mutate(
              { mailboxId: mailbox.id },
              { onError: showMutationError("Could not remove mailbox.") }
            );
          }}
          onUsefulDetailsChange={(enabled) => {
            setGmailUsefulDetailsMutation.mutate({
              enabled,
              mailboxId: mailbox.id,
            });
          }}
          usefulDetailsEnabled={mailbox.usefulDetailsEnabled}
          usefulDetailsSwitchId={usefulDetailsSwitchId}
        />
      )}

      {isManagedNonManager && (
        <SettingsSection title="Mailbox settings">
          <SettingsCard className="p-6">
            <p className="text-body text-fg">Manager access required</p>
            <p className="mt-1 max-w-2xl text-body/6 text-muted-fg">
              A mailbox manager can change shared-inbox features, routing, and
              member access. Your current role still lets you use every mail
              action included with that role.
            </p>
          </SettingsCard>
        </SettingsSection>
      )}

      {isManagedManager && (
        <ManagedMailboxManagerSettingsSection
          detailManagedDivisions={detailManagedDivisions}
          detailManagedMembers={detailManagedMembers}
          emailAddress={mailbox.emailAddress}
          hasAutomationAccess={hasAutomationAccess}
          includeApiMessagesSwitchId={includeApiMessagesSwitchId}
          mailboxId={mailbox.id}
          managedMailboxQuery={managedMailboxQuery}
          removeManagedMailboxDivisionGrantMutation={
            removeManagedMailboxDivisionGrantMutation
          }
          removeManagedMailboxGrantMutation={removeManagedMailboxGrantMutation}
          setGmailAutoLabelingMutation={setGmailAutoLabelingMutation}
          setGmailUsefulDetailsMutation={setGmailUsefulDetailsMutation}
          setManagedMailboxDivisionGrantMutation={
            setManagedMailboxDivisionGrantMutation
          }
          setManagedMailboxGrantMutation={setManagedMailboxGrantMutation}
          updateManagedMailboxMutation={updateManagedMailboxMutation}
        />
      )}

      {isApi && (
        <SettingsSection title="Mailbox capabilities">
          <SettingsCard className="p-6">
            <p className="text-body text-fg">Send-only mailbox</p>
            <p className="mt-1 max-w-2xl text-body/6 text-muted-fg">
              This address sends through your team API. Its domain and access
              are managed in team settings.
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                runDetached(async () => {
                  await navigate({
                    search: (previous) => ({
                      ...previous,
                      mailboxId: "",
                      organizationId: mailbox.organizationId,
                      organizationView: "api-keys",
                      tab: "organization",
                    }),
                    to: ".",
                  });
                });
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Open team settings
              <HugeiconsIcon
                aria-hidden
                className="size-4"
                icon={ArrowRight01Icon}
              />
            </Button>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  );
};
