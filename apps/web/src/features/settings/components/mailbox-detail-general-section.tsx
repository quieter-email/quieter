"use client";

import {
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";

import { MailboxAccessPill } from "#/features/mailbox/components/mailbox-access-pill";
import type { MailboxGrantRole } from "#/features/mailbox/components/mailbox-access-pill";
import {
  showMutationError,
  runDetached,
} from "#/features/settings/components/mailboxes-settings-shared";
import {
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "#/features/settings/components/settings-layout";

const getGrantRoleDescription = (grantRole: MailboxGrantRole) => {
  if (grantRole === "manager") {
    return "You can configure this shared inbox and its access.";
  }
  if (grantRole === "responder") {
    return "You can read and reply, but only managers can change mailbox settings.";
  }
  return "You can read this inbox, but only managers can change mailbox settings.";
};

export const MailboxDetailGeneralSection = ({
  defaultMailboxId,
  isDefaultMailboxPending,
  isMovePending,
  isStartingGmail,
  mailbox,
  moveGmailMailboxMutation,
  onSetDefaultMailbox,
  onStartGmailConnection,
  organizations,
  placementItems,
}: {
  defaultMailboxId: string | null;
  isDefaultMailboxPending: boolean;
  isMovePending: boolean;
  isStartingGmail: boolean;
  mailbox: {
    connectionStatus: string;
    emailAddress: string;
    grantRole?: MailboxGrantRole | null;
    id: string;
    organizationId: string;
    provider: string;
  };
  moveGmailMailboxMutation: {
    isPending: boolean;
    mutate: (
      variables: { mailboxId: string; organizationId: string },
      options?: { onError?: (error: unknown) => void }
    ) => void;
  };
  onSetDefaultMailbox: (mailboxId: string) => void;
  onStartGmailConnection: (input: {
    mailboxId: string;
    organizationId: string;
  }) => Promise<void>;
  organizations: { id: string; name: string }[];
  placementItems: { label: string; value: string }[];
}) => {
  const isDefault = mailbox.id === defaultMailboxId;

  return (
    <SettingsSection
      description="Choose where this mailbox appears and which mailbox opens by default."
      title="General"
    >
      <SettingsRows>
        {mailbox.provider !== "api" && (
          <SettingsRow
            action={
              <Button
                disabled={isDefaultMailboxPending}
                onClick={() => {
                  onSetDefaultMailbox(mailbox.id);
                }}
                pending={isDefaultMailboxPending}
                pendingLabel="Saving…"
                size="sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={isDefault ? PinIcon : PinOffIcon}
                />
                {isDefault ? "Default" : "Set as default"}
              </Button>
            }
            title="Default mailbox"
          >
            Open this mailbox when no other mailbox is selected.
          </SettingsRow>
        )}

        {mailbox.provider === "gmail" && (
          <SettingsRow
            action={
              <Select
                disabled={isMovePending}
                items={placementItems}
                onValueChange={(value = "") => {
                  if (value === "" || value === null) {
                    return;
                  }
                  moveGmailMailboxMutation.mutate(
                    { mailboxId: mailbox.id, organizationId: value },
                    {
                      onError: showMutationError("Could not move mailbox."),
                    }
                  );
                }}
                value={mailbox.organizationId}
              >
                <SelectTrigger
                  aria-label={`Team for ${mailbox.emailAddress}`}
                  className="max-w-44"
                  pending={isMovePending}
                  size="sm"
                  variant="ghost"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            title="Team"
          >
            Placement keeps mailbox switching organized; this mailbox remains
            private to you.
          </SettingsRow>
        )}

        {mailbox.provider === "managed" &&
          mailbox.grantRole !== undefined &&
          mailbox.grantRole !== null && (
            <SettingsRow
              action={<MailboxAccessPill role={mailbox.grantRole} />}
              title="Your access"
            >
              {getGrantRoleDescription(mailbox.grantRole)}
            </SettingsRow>
          )}

        {mailbox.provider === "gmail" && (
          <SettingsRow
            action={
              mailbox.connectionStatus === "needs_reconnect" ? (
                <Button
                  disabled={isStartingGmail}
                  onClick={() => {
                    runDetached(async () => {
                      await onStartGmailConnection({
                        mailboxId: mailbox.id,
                        organizationId: mailbox.organizationId,
                      });
                    });
                  }}
                  pending={isStartingGmail}
                  pendingLabel="Connecting…"
                  size="sm"
                  type="button"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className={cn("size-4", {
                      "animate-spin": isStartingGmail,
                    })}
                    icon={isStartingGmail ? Loading03Icon : Mail01Icon}
                  />
                  Reconnect
                </Button>
              ) : (
                <span className="text-caption text-muted-fg">Connected</span>
              )
            }
            title="Connection"
          >
            {mailbox.connectionStatus === "needs_reconnect"
              ? "Reconnect through Google to resume reading and sending mail."
              : "Quieter can read and send mail for this account."}
          </SettingsRow>
        )}
      </SettingsRows>
    </SettingsSection>
  );
};
