"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { useNavigate } from "@tanstack/react-router";

import { GmailMailboxDetailSections } from "#/features/settings/components/gmail-mailbox-detail-sections";
import { GmailMailboxNameSettings } from "#/features/settings/components/gmail-mailbox-name-settings";
import { MailboxBriefSettings } from "#/features/settings/components/mailbox-brief-settings";
import { MailboxDetailGeneralSection } from "#/features/settings/components/mailbox-detail-general-section";
import type {
  ManagedMailboxAccessModeInput,
  ManagedMailboxDivisionGrantInput,
  ManagedMailboxGrantInput,
  ManagedMailboxToggleInput,
  ManagedMailboxUpdateInput,
  SettingsMutation,
} from "#/features/settings/components/mailbox-detail-mutation-types";
import { MailboxRemovalSettings } from "#/features/settings/components/mailbox-removal-settings";
import { MailboxSignatureSettings } from "#/features/settings/components/mailbox-signature-settings";
import {
  getMailboxDisplayTitle,
  hasTrimmedDisplayName,
  runDetached,
} from "#/features/settings/components/mailboxes-settings-shared";
import { ManagedMailboxManagerSettingsSection } from "#/features/settings/components/managed-mailbox-manager-settings-section";
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsSection,
  settingsSurfaceVariants,
} from "#/features/settings/components/settings-layout";
import { toastError } from "#/lib/error-toast";

type Mailbox =
  RouterOutputs["mail"]["listMailboxes"]["groups"][number]["mailboxes"][number];

type ManagedMailboxQuery = {
  data: RouterOutputs["mail"]["getManagedMailboxDetails"] | undefined;
  error: Error | null;
  isPending: boolean;
};

export const MailboxDetailSettingsContent = ({
  canMakePrivate,
  defaultMailboxId,
  deleteManagedMailboxMutation,
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
  setManagedMailboxAccessModeMutation,
  setManagedMailboxDivisionGrantMutation,
  setManagedMailboxGrantMutation,
  updateManagedMailboxMutation,
}: {
  canMakePrivate: boolean;
  defaultMailboxId: string | null;
  deleteManagedMailboxMutation: SettingsMutation<{ mailboxId: string }>;
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
  setManagedMailboxAccessModeMutation: SettingsMutation<ManagedMailboxAccessModeInput>;
  setManagedMailboxDivisionGrantMutation: SettingsMutation<ManagedMailboxDivisionGrantInput>;
  setManagedMailboxGrantMutation: SettingsMutation<ManagedMailboxGrantInput>;
  updateManagedMailboxMutation: SettingsMutation<ManagedMailboxUpdateInput>;
}) => {
  const navigate = useNavigate({ from: "/settings" });
  const title = getMailboxDisplayTitle(
    mailbox.displayName,
    mailbox.emailAddress
  );
  const autoLabelSwitchId = `gmail-auto-label-${mailbox.id}`;
  const includeApiMessagesSwitchId = `managed-api-messages-${mailbox.id}`;
  const isGmail = mailbox.provider === "gmail";
  const isManagedManager =
    mailbox.provider === "managed" && mailbox.grantRole === "manager";
  const isManagedNonManager =
    mailbox.provider === "managed" && mailbox.grantRole !== "manager";
  const isApi = mailbox.provider === "api";

  return (
    <div className={settingsSurfaceVariants({ variant: "page" })}>
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
        <GmailMailboxNameSettings
          key={`name-${mailbox.id}`}
          mailbox={mailbox}
        />
      )}

      {(isGmail || isManagedManager) && (
        <MailboxSignatureSettings
          key={`signature-${mailbox.id}`}
          mailbox={mailbox}
        />
      )}

      {(isGmail || mailbox.provider === "managed") && (
        <MailboxBriefSettings key={`brief-${mailbox.id}`} mailbox={mailbox} />
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
              {
                onError: (error) => {
                  toastError(error, {
                    boundary: "mailbox-settings",
                    fallback: "Could not remove mailbox.",
                  });
                },
              }
            );
          }}
        />
      )}

      {isManagedNonManager && (
        <SettingsSection title="Mailbox settings">
          <SettingsCard
            className={settingsSurfaceVariants({ variant: "body" })}
          >
            <p className="text-body text-fg">Manager access required</p>
            <p className="mt-1 max-w-2xl text-body/6 text-muted-fg">
              A mailbox manager can change inbox features, routing, and member
              access. Your current role still lets you use every mail action
              included with that role.
            </p>
          </SettingsCard>
        </SettingsSection>
      )}

      {isManagedManager && (
        <ManagedMailboxManagerSettingsSection
          canMakePrivate={canMakePrivate}
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
          setManagedMailboxAccessModeMutation={
            setManagedMailboxAccessModeMutation
          }
          setManagedMailboxDivisionGrantMutation={
            setManagedMailboxDivisionGrantMutation
          }
          setManagedMailboxGrantMutation={setManagedMailboxGrantMutation}
          updateManagedMailboxMutation={updateManagedMailboxMutation}
        />
      )}

      {isManagedManager && (
        <MailboxRemovalSettings
          key={mailbox.id}
          emailAddress={mailbox.emailAddress}
          isPending={deleteManagedMailboxMutation.isPending}
          kind="managed"
          onRemove={() => {
            deleteManagedMailboxMutation.mutate(
              { mailboxId: mailbox.id },
              {
                onError: (error) => {
                  toastError(error, {
                    boundary: "mailbox-settings",
                    fallback: "Could not delete mailbox.",
                  });
                },
              }
            );
          }}
        />
      )}

      {isApi && (
        <SettingsSection title="Mailbox capabilities">
          <SettingsCard
            className={settingsSurfaceVariants({ variant: "body" })}
          >
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
