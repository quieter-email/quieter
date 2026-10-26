"use client";

import { MailboxRemovalSettings } from "@quieter/app/features/settings/components/mailbox-removal-settings";
import {
  SettingsCard,
  SettingsInlineLoading,
  SettingsInsetRows,
  SettingsRow,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { authClient } from "@quieter/app/lib/auth";
import { calendarAccountsQueryOptions } from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { openGoogleAccountLink } from "@quieter/app/lib/google-account-link";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";

export const GmailCalendarConnectionRow = ({
  connectionStatus,
  emailAddress,
  mailboxId,
}: {
  connectionStatus: string;
  emailAddress: string;
  mailboxId: string;
}) => {
  const userId = authClient.useSession().data?.user.id;
  const queryClient = useQueryClient();
  const returnTo = useLocation({ select: (location) => location.href });
  const accounts = useQuery({
    ...calendarAccountsQueryOptions(userId ?? ""),
    enabled: userId !== undefined,
  });
  const [pendingAction, setPendingAction] = useState<
    "connect" | "retry" | null
  >(null);
  const account = accounts.data?.accounts.find(
    (candidate) => candidate.mailboxId === mailboxId
  );
  const connected = account?.status === "connected";
  const needsReconnect =
    connectionStatus === "needs_reconnect" ||
    account?.status === "needs-reconnect";
  const enableCalendar = async () => {
    setPendingAction("connect");
    try {
      await openGoogleAccountLink({
        loginHint: emailAddress,
        mailboxId,
        queryClient,
        returnTo,
      });
    } catch (error) {
      toastError(error, { boundary: "gmail-connect" });
    } finally {
      setPendingAction(null);
    }
  };
  const retry = async () => {
    setPendingAction("retry");
    try {
      await accounts.refetch({ throwOnError: true });
    } catch (error) {
      toastError(error, { boundary: "gmail-connect" });
    } finally {
      setPendingAction(null);
    }
  };

  let description =
    "Allow calendar access for this Google account to view events and add invitations.";
  if (needsReconnect) {
    description = "Reconnect this mailbox to restore mail and calendar access.";
  } else if (connected) {
    description =
      "Your calendars use this mailbox's Google connection and stay private to you.";
  } else if (accounts.isError) {
    description = "Calendar access could not be checked. Try again.";
  }

  let action;
  if (accounts.isPending) {
    action = <SettingsInlineLoading label="Checking calendar access" />;
  } else if (accounts.isError) {
    action = (
      <Button
        onClick={() => {
          void retry();
        }}
        pending={pendingAction === "retry"}
        size="sm"
        variant="secondary"
      >
        Retry
      </Button>
    );
  } else if (connected && !needsReconnect) {
    action = <span className="text-caption text-muted-fg">Connected</span>;
  } else if (connectionStatus !== "needs_reconnect") {
    action = (
      <Button
        onClick={() => {
          void enableCalendar();
        }}
        pending={pendingAction === "connect"}
        pendingLabel="Opening Google"
        size="sm"
      >
        {needsReconnect ? "Reconnect" : "Enable calendar"}
      </Button>
    );
  }

  return (
    <SettingsRow action={action} title="Calendar">
      {description}
    </SettingsRow>
  );
};

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
