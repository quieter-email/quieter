"use client";

import { Loading03Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { runDetached } from "@quieter/app/features/settings/components/mailboxes-settings-shared";
import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsNavigationRow,
  SettingsPageHeader,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import { settingsDestinationSearch } from "@quieter/app/features/settings/domain/settings-destination";
import { getConnectorIcon } from "@quieter/app/lib/connector-icons";
import {
  CONNECTORS_QUERY_KEY,
  connectorsQueryOptions,
  openConnectorLink,
} from "@quieter/app/lib/connectors-query";
import type { ConnectorProvider } from "@quieter/app/lib/connectors-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { settingsRouteApi } from "@quieter/app/lib/route-apis";
import type { RouterOutputs } from "@quieter/orpc";
import {
  AlertDialog,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type Connector = RouterOutputs["connectors"]["list"]["connectors"][number];
type ConnectorAccount = Connector["accounts"][number];
type PendingConnection =
  | { kind: "add" }
  | { kind: "reconnect"; connectionId: string }
  | null;

const connectorAccess = {
  clickup: {
    description:
      "Browse selected workspaces and their tasks. Create tasks and update their details or status.",
    title: "Workspaces you authorize",
  },
  linear: {
    description:
      "Search and read issues and projects. Create issues and update their details.",
    title: "Your Linear workspace",
  },
  microsoft_calendar: {
    description:
      "Read your calendars and availability. Create, update, and delete events where your account has permission.",
    title: "Your calendars and events",
  },
  microsoft_onedrive: {
    description:
      "Browse and search your drive. Read text files and view file details, with links to open other documents.",
    title: "Files in your drive",
  },
  notion: {
    description:
      "Search and read selected pages. Create pages and add content where you grant access.",
    title: "Pages you choose",
  },
  todoist: {
    description:
      "Read your projects and active tasks. Create, update, and complete tasks.",
    title: "Your projects and tasks",
  },
} satisfies Record<ConnectorProvider, { description: string; title: string }>;

const getAccountLabel = (account: ConnectorAccount) => {
  const identity = account.accountEmail?.trim() || account.displayName?.trim();
  const workspace = account.providerWorkspaceName?.trim();
  return (
    [identity, workspace]
      .filter(
        (part, index, parts) =>
          part !== undefined &&
          part.length > 0 &&
          parts.findIndex(
            (candidate) => candidate?.toLowerCase() === part.toLowerCase()
          ) === index
      )
      .join(", ") || "Connected account"
  );
};

const ConnectorIcon = ({ provider }: { provider: ConnectorProvider }) => {
  const icon = getConnectorIcon(provider);
  return (
    <img
      alt=""
      aria-hidden
      className={cn("size-4", icon.className)}
      height={16}
      src={icon.src}
      width={16}
    />
  );
};

const ConnectorDetail = ({ connector }: { connector: Connector }) => {
  const queryClient = useQueryClient();
  const { from, organizationId } = settingsRouteApi.useSearch();
  const [pendingConnection, setPendingConnection] =
    useState<PendingConnection>(null);
  const [disconnectTarget, setDisconnectTarget] =
    useState<ConnectorAccount | null>(null);
  const disconnectMutation = useMutation({
    ...orpc.connectors.disconnect.mutationOptions(),
    mutationKey: ["connectors", "disconnect"],
    onError: (error) => {
      toastError(error, { boundary: "connectors" });
    },
    onSuccess: async () => {
      setDisconnectTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      ]);
      toast.success("Account disconnected.");
    },
  });
  const startConnection = async (connectionId?: string) => {
    setPendingConnection(
      connectionId ? { connectionId, kind: "reconnect" } : { kind: "add" }
    );
    const search = new URLSearchParams({
      connectorProvider: connector.provider,
      from,
      organizationId,
      tab: "connectors",
    });
    try {
      await openConnectorLink({
        connectionId,
        provider: connector.provider,
        returnTo: `/settings?${search.toString()}`,
      });
    } catch (error) {
      toastError(error, {
        boundary: "connectors",
        fallback: "Could not start account setup.",
      });
    } finally {
      setPendingConnection(null);
    }
  };
  const unavailable = !connector.isConfigured;
  const isBusy = pendingConnection !== null || disconnectMutation.isPending;
  const access = connectorAccess[connector.provider];
  const connectButton = (
    <Button
      disabled={unavailable || isBusy}
      onClick={() => {
        runDetached(async () => {
          await startConnection();
        });
      }}
      size="sm"
      type="button"
    >
      {pendingConnection?.kind === "add" && (
        <Icon aria-hidden animation="spin" icon={Loading03Icon} />
      )}
      {connector.accounts.length > 0 ? "Add account" : "Connect account"}
    </Button>
  );

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        action={connector.accounts.length > 0 ? connectButton : undefined}
        title={connector.displayName}
      >
        {connector.description}
      </SettingsPageHeader>
      <SettingsSection
        description="Your connected accounts are private to you."
        title="Accounts"
      >
        <SettingsRows>
          {connector.accounts.length === 0 ? (
            <SettingsRow action={connectButton} title="No accounts connected">
              {unavailable
                ? "Connecting accounts is currently unavailable. Please try again later."
                : `Connect your ${connector.displayName} account to get started.`}
            </SettingsRow>
          ) : (
            connector.accounts.map((account) => {
              const accountLabel = getAccountLabel(account);
              const needsReconnect = account.status !== "connected";
              const isReconnecting =
                pendingConnection?.kind === "reconnect" &&
                pendingConnection.connectionId === account.id;
              return (
                <SettingsRow
                  action={
                    <div className="flex items-center gap-2">
                      {needsReconnect && (
                        <Button
                          disabled={unavailable || isBusy}
                          onClick={() => {
                            runDetached(async () => {
                              await startConnection(account.id);
                            });
                          }}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {isReconnecting && (
                            <Icon
                              aria-hidden
                              animation="spin"
                              icon={Loading03Icon}
                            />
                          )}
                          Reconnect
                        </Button>
                      )}
                      <DropdownMenu>
                        <IconButtonTooltip label="Account actions">
                          <DropdownMenuTrigger
                            render={
                              <Button
                                aria-label={`Actions for ${accountLabel}`}
                                disabled={isBusy}
                                size="icon-sm"
                                variant="ghost"
                              />
                            }
                          >
                            {isReconnecting ? (
                              <Icon
                                aria-hidden
                                animation="spin"
                                icon={Loading03Icon}
                              />
                            ) : (
                              <Icon aria-hidden icon={MoreHorizontalIcon} />
                            )}
                          </DropdownMenuTrigger>
                        </IconButtonTooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={unavailable || isBusy}
                            onSelect={() => {
                              runDetached(async () => {
                                await startConnection(account.id);
                              });
                            }}
                          >
                            Reconnect
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isBusy}
                            onSelect={() => {
                              setDisconnectTarget(account);
                            }}
                            tone="destructive"
                          >
                            Disconnect account
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  }
                  key={account.id}
                  title={accountLabel}
                >
                  {needsReconnect ? "Reconnect needed" : "Connected"}
                </SettingsRow>
              );
            })
          )}
        </SettingsRows>
        {unavailable && connector.accounts.length > 0 && (
          <Text size="sm" tone="muted">
            Adding and reconnecting accounts is currently unavailable. You can
            still disconnect an account.
          </Text>
        )}
      </SettingsSection>
      <SettingsSection title="Access">
        <SettingsRows>
          <SettingsRow title={access.title}>{access.description}</SettingsRow>
        </SettingsRows>
      </SettingsSection>
      <Text size="sm" tone="muted">
        Type @ in chat or action instructions to choose a connected{" "}
        {connector.displayName} account.
        {connector.provider === "microsoft_calendar" &&
          " Your events also appear in Calendar."}
      </Text>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !disconnectMutation.isPending) {
            setDisconnectTarget(null);
          }
        }}
        open={disconnectTarget !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect account?</AlertDialogTitle>
            <AlertDialogDescription>
              Disconnect{" "}
              {disconnectTarget
                ? getAccountLabel(disconnectTarget)
                : "this account"}{" "}
              from {connector.displayName} in Quieter? You can connect it again
              later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCloseButton disabled={disconnectMutation.isPending}>
              Cancel
            </AlertDialogCloseButton>
            <Button
              disabled={disconnectMutation.isPending}
              onClick={() => {
                if (disconnectTarget) {
                  disconnectMutation.mutate({
                    connectionId: disconnectTarget.id,
                    provider: connector.provider,
                  });
                }
              }}
              size="sm"
              type="button"
              variant="destructive"
            >
              {disconnectMutation.isPending && (
                <Icon aria-hidden animation="spin" icon={Loading03Icon} />
              )}
              Disconnect account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export const ConnectorsSettingsPanel = () => {
  const navigate = settingsRouteApi.useNavigate();
  const { connectorProvider, organizationId } = settingsRouteApi.useSearch();
  const { data, error, isError, isLoading, refetch } = useQuery(
    connectorsQueryOptions()
  );
  const connectors = data?.connectors ?? [];
  const selectedConnector = connectors.find(
    (connector) => connector.provider === connectorProvider
  );
  const connected = connectors.filter(
    (connector) => connector.accounts.length > 0
  );
  const available = connectors.filter(
    (connector) => connector.accounts.length === 0
  );

  return (
    <div className="space-y-6">
      {!selectedConnector && (
        <SettingsPageHeader title="Connected apps">
          Manage the apps you use with Quieter. Your connected accounts are
          private to you.
        </SettingsPageHeader>
      )}
      {isError && (
        <SettingsErrorState
          message={error.message || "Could not load connected apps."}
          onRetry={() => {
            runDetached(async () => {
              await refetch();
            });
          }}
        />
      )}
      {isLoading && connectors.length === 0 && (
        <SettingsLoadingState label="Loading connected apps" />
      )}
      {selectedConnector ? (
        <ConnectorDetail
          connector={selectedConnector}
          key={selectedConnector.provider}
        />
      ) : (
        [
          { connectors: connected, title: "Connected" },
          { connectors: available, title: "Available" },
        ].map(
          (group) =>
            group.connectors.length > 0 && (
              <SettingsSection key={group.title} title={group.title}>
                <SettingsRows>
                  {group.connectors.map((connector) => {
                    let description = connector.isConfigured
                      ? connector.description
                      : "Connecting accounts is currently unavailable.";
                    if (connector.accounts.length > 0) {
                      description = connector.accounts.some(
                        (account) => account.status !== "connected"
                      )
                        ? "Reconnect needed"
                        : `${connector.accounts.length} ${connector.accounts.length === 1 ? "account" : "accounts"} connected`;
                    }
                    return (
                      <SettingsNavigationRow
                        description={description}
                        icon={<ConnectorIcon provider={connector.provider} />}
                        key={connector.provider}
                        onClick={() => {
                          void navigate({
                            search: (previous) => ({
                              ...previous,
                              ...settingsDestinationSearch(
                                { tab: "connectors" },
                                organizationId
                              ),
                              connectorProvider: connector.provider,
                            }),
                            to: ".",
                          });
                        }}
                        title={connector.displayName}
                      />
                    );
                  })}
                </SettingsRows>
              </SettingsSection>
            )
        )
      )}
      {!isLoading && !isError && connectors.length === 0 && (
        <SettingsRows>
          <SettingsRow title="No apps available">
            Connected apps will appear here when they are available.
          </SettingsRow>
        </SettingsRows>
      )}
    </div>
  );
};
