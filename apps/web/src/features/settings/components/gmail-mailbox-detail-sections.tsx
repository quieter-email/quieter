"use client";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Switch, SwitchThumb } from "@quieter/ui/switch";

import { switchVariants } from "#/features/settings/components/mailboxes-settings-shared";
import {
  SettingsCard,
  SettingsInsetRows,
  SettingsRow,
  SettingsSection,
  settingsSurfaceVariants,
} from "#/features/settings/components/settings-layout";

export const GmailMailboxDetailSections = ({
  autoLabelEnabled,
  autoLabelSwitchId,
  connectionStatus,
  disconnectPending,
  emailAddress,
  hasAutomationAccess,
  isAutoLabelPending,
  isUsefulDetailsPending,
  onAutoLabelChange,
  onDisconnect,
  onUsefulDetailsChange,
  usefulDetailsEnabled,
  usefulDetailsSwitchId,
}: {
  autoLabelEnabled: boolean;
  autoLabelSwitchId: string;
  connectionStatus: string;
  disconnectPending: boolean;
  emailAddress: string;
  hasAutomationAccess: boolean;
  isAutoLabelPending: boolean;
  isUsefulDetailsPending: boolean;
  onAutoLabelChange: (enabled: boolean) => void;
  onDisconnect: () => void;
  onUsefulDetailsChange: (enabled: boolean) => void;
  usefulDetailsEnabled: boolean;
  usefulDetailsSwitchId: string;
}) => (
  <>
    <SettingsSection
      description="Optional features that organize new Inbox mail and surface timely information."
      title="Intelligence"
    >
      <SettingsCard>
        <SettingsInsetRows>
          <label
            className={cn(
              settingsSurfaceVariants({ variant: "insetRow" }),
              "cursor-pointer gap-3"
            )}
            htmlFor={usefulDetailsSwitchId}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-fg">Useful details</span>
              <span className="mt-0.5 block text-xs/5 text-muted-fg">
                Show codes, deliveries, and deadlines above the inbox.
                {!hasAutomationAccess && " Requires Pro access for this team."}
              </span>
            </span>
            <Switch
              aria-label={`Find time-sensitive updates in new mail for ${emailAddress}`}
              checked={usefulDetailsEnabled}
              className={switchVariants()}
              disabled={
                !hasAutomationAccess ||
                isUsefulDetailsPending ||
                connectionStatus !== "connected"
              }
              id={usefulDetailsSwitchId}
              pending={isUsefulDetailsPending}
              onCheckedChange={onUsefulDetailsChange}
            >
              <SwitchThumb className="size-4 data-checked:translate-x-4" />
            </Switch>
          </label>
          <label
            className={cn(
              settingsSurfaceVariants({ variant: "insetRow" }),
              "cursor-pointer gap-3"
            )}
            htmlFor={autoLabelSwitchId}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-fg">Auto-label</span>
              <span className="mt-0.5 block text-xs/5 text-muted-fg">
                Label new Inbox mail using each label&apos;s inclusion criteria.
                {!hasAutomationAccess && " Requires Pro access for this team."}
              </span>
            </span>
            <Switch
              aria-label={`Automatically label new mail for ${emailAddress}`}
              checked={autoLabelEnabled}
              className={switchVariants()}
              disabled={
                !hasAutomationAccess ||
                isAutoLabelPending ||
                connectionStatus !== "connected"
              }
              id={autoLabelSwitchId}
              pending={isAutoLabelPending}
              onCheckedChange={onAutoLabelChange}
            >
              <SwitchThumb className="size-4 data-checked:translate-x-4" />
            </Switch>
          </label>
        </SettingsInsetRows>
      </SettingsCard>
    </SettingsSection>

    <SettingsSection title="Remove mailbox">
      <SettingsCard>
        <SettingsRow
          action={
            <Button
              className="text-destructive hover:text-destructive"
              disabled={disconnectPending}
              onClick={onDisconnect}
              pending={disconnectPending}
              pendingLabel="Removing…"
              size="sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-4"
                icon={Delete02Icon}
              />
              Remove
            </Button>
          }
          title="Disconnect Gmail"
        >
          Remove this account and its saved credentials from Quieter.
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  </>
);
