"use client";

import { MailboxRemovalSettings } from "@quieter/app/features/settings/components/mailbox-removal-settings";
import {
  SettingsCard,
  SettingsInsetRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { cn } from "@quieter/ui/cn";
import { Switch, SwitchThumb } from "@quieter/ui/switch";

export const GmailMailboxDetailSections = ({
  autoLabelEnabled,
  autoLabelSwitchId,
  connectionStatus,
  disconnectPending,
  emailAddress,
  hasAutomationAccess,
  onAutoLabelChange,
  onDisconnect,
}: {
  autoLabelEnabled: boolean;
  autoLabelSwitchId: string;
  connectionStatus: string;
  disconnectPending: boolean;
  emailAddress: string;
  hasAutomationAccess: boolean;
  onAutoLabelChange: (enabled: boolean) => void;
  onDisconnect: () => void;
}) => (
  <>
    <SettingsSection
      description="Organize new Inbox mail with your labels."
      title="Intelligence"
    >
      <SettingsCard>
        <SettingsInsetRows>
          <label
            className={cn(
              settingsSurfaceVariants({ variant: "insetRow" }),
              "cursor-pointer gap-3"
            )}
            htmlFor={autoLabelSwitchId}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body text-fg">Auto-label</span>
              <span className="mt-0.5 block text-caption/5 text-muted-fg">
                Label new Inbox mail using each label&apos;s inclusion criteria.
                {!hasAutomationAccess && " Requires Pro access for this team."}
              </span>
            </span>
            <Switch
              aria-label={`Automatically label new mail for ${emailAddress}`}
              checked={autoLabelEnabled}
              className="shrink-0"
              size="sm"
              disabled={
                !hasAutomationAccess || connectionStatus !== "connected"
              }
              id={autoLabelSwitchId}
              onCheckedChange={onAutoLabelChange}
            >
              <SwitchThumb />
            </Switch>
          </label>
        </SettingsInsetRows>
      </SettingsCard>
    </SettingsSection>
    <MailboxRemovalSettings
      key={emailAddress}
      emailAddress={emailAddress}
      isPending={disconnectPending}
      kind="gmail"
      onRemove={onDisconnect}
    />
  </>
);
