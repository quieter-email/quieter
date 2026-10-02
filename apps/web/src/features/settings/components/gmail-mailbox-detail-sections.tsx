"use client";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Switch, SwitchThumb } from "@quieter/ui/switch";

import {
  SettingsCard,
  SettingsInsetRows,
  SettingsRow,
  SettingsSection,
  settingsSurfaceVariants,
} from "#/features/settings/components/settings-layout";
import { settingsRouteApi } from "#/lib/route-apis";

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
}) => {
  const { section } = settingsRouteApi.useSearch();
  return (
    <>
      {section !== "connection" && (
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
                    Label new Inbox mail using each label&apos;s inclusion
                    criteria.
                    {!hasAutomationAccess &&
                      " Requires Pro access for this team."}
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
      )}
      {section === "connection" && (
        <SettingsSection title="Remove mailbox">
          <SettingsCard>
            <SettingsRow
              action={
                <Button
                  // oxlint-disable-next-line shadcn/no-restyle -- Disconnect action keeps its destructive ghost text.
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
      )}
    </>
  );
};
