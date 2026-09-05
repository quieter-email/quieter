"use client";

import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  getMailboxDisplayTitle,
  getProviderLabel,
  hasTrimmedDisplayName,
  runDetached,
} from "#/features/settings/components/mailboxes-settings-shared";
import {
  SettingsCard,
  SettingsErrorState,
  SettingsLoadingState,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRows,
  SettingsSection,
} from "#/features/settings/components/settings-layout";
import { prefetchMailboxSettingsDetail } from "#/features/settings/components/settings-prefetch";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";

import { ManagedMailboxAdministrationSettings } from "./managed-mailbox-administration-settings";

type MailboxGroup = RouterOutputs["mail"]["listMailboxes"]["groups"][number];

const getMailboxRowMeta = (
  mailboxId: string,
  defaultMailboxId: string | null,
  connectionStatus: string
) => {
  if (connectionStatus === "needs_reconnect") {
    return <span className="text-destructive">Reconnect</span>;
  }
  if (mailboxId === defaultMailboxId) {
    return <span>Default</span>;
  }
  return null;
};

const getMailboxRowDescription = (
  displayName: string | null | undefined,
  emailAddress: string,
  provider: string,
  grantRole: string | null | undefined,
  accessMode: string | null
) => {
  const parts: (string | null)[] = [
    hasTrimmedDisplayName(displayName) ? emailAddress : null,
    getProviderLabel(provider, accessMode),
    provider === "managed" && (grantRole ?? "") !== ""
      ? `${grantRole} access`
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(", ");
};

const MailboxesListContent = ({
  defaultMailboxId,
  groups,
  onNavigateToMailbox,
  queryClient,
}: {
  defaultMailboxId: string | null;
  groups: MailboxGroup[];
  onNavigateToMailbox: (mailboxId: string) => Promise<void>;
  queryClient: QueryClient;
}) => {
  if (groups.length === 0) {
    return (
      <SettingsCard className="p-6">
        <p className="text-body text-fg">No mailboxes yet</p>
        <p className="mt-1 text-body/6 text-muted-fg">
          Connect Gmail or create a mailbox to start using Quieter.
        </p>
      </SettingsCard>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div className="space-y-2" key={group.id}>
          <p className="px-1 text-caption text-muted-fg">{group.name}</p>
          <SettingsRows>
            {group.mailboxes.map((mailbox) => (
              <SettingsNavigationRow
                description={getMailboxRowDescription(
                  mailbox.displayName,
                  mailbox.emailAddress,
                  mailbox.provider,
                  mailbox.grantRole,
                  mailbox.accessMode
                )}
                key={mailbox.id}
                meta={getMailboxRowMeta(
                  mailbox.id,
                  defaultMailboxId,
                  mailbox.connectionStatus
                )}
                onClick={() => {
                  runDetached(async () => {
                    await onNavigateToMailbox(mailbox.id);
                  });
                }}
                onIntent={() => {
                  runDetached(async () => {
                    await prefetchMailboxSettingsDetail(queryClient, mailbox);
                  });
                }}
                title={getMailboxDisplayTitle(
                  mailbox.displayName,
                  mailbox.emailAddress
                )}
              />
            ))}
          </SettingsRows>
        </div>
      ))}
    </div>
  );
};

export const MailboxesListSettingsView = () => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const {
    data: mailboxesData,
    error: mailboxesError,
    isError: isMailboxesError,
    isPending: areMailboxesPending,
    refetch: refetchMailboxes,
  } = useQuery(mailboxesQueryOptions());
  const groups = mailboxesData?.groups ?? [];
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;

  const navigateToMailbox = async (mailboxId: string) => {
    await navigate({
      search: (previous) => ({
        ...previous,
        mailboxId,
        mailboxView: "list",
        tab: "mailboxes",
      }),
      to: ".",
    });
  };

  const renderMailboxSection = () => {
    if (isMailboxesError) {
      return (
        <SettingsErrorState
          message={mailboxesError.message ?? "Could not load mailboxes."}
          onRetry={() => {
            runDetached(async () => {
              await refetchMailboxes();
            });
          }}
        />
      );
    }

    if (areMailboxesPending) {
      return <SettingsLoadingState label="Loading mailboxes" />;
    }

    return (
      <MailboxesListContent
        defaultMailboxId={defaultMailboxId}
        groups={groups}
        onNavigateToMailbox={navigateToMailbox}
        queryClient={queryClient}
      />
    );
  };

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        action={
          <Button
            onClick={() => {
              void navigate({
                search: (previous) => ({
                  ...previous,
                  mailboxId: "",
                  mailboxView: "add",
                  tab: "mailboxes",
                }),
                to: ".",
              });
            }}
            size="sm"
            type="button"
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
            Add mailbox
          </Button>
        }
        title="Mailboxes"
      >
        Connect personal mail and manage the mailboxes you can access.
      </SettingsPageHeader>

      <SettingsSection title="Your mailboxes">
        {renderMailboxSection()}
      </SettingsSection>
      <ManagedMailboxAdministrationSettings />
    </div>
  );
};
