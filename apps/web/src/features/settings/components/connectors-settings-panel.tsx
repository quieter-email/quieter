"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { runDetached } from "#/features/settings/components/mailboxes-settings-shared";
import {
  CONNECTORS_QUERY_KEY,
  connectorsQueryOptions,
  openConnectorLink,
} from "#/lib/connectors-query";
import type { ConnectorProvider } from "#/lib/connectors-query";
import { orpc } from "#/lib/orpc";

import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-layout";

const getSettingsReturnTo = () => "/settings?tab=connectors";

const connectorIcons = {
  google_calendar: (
    <img
      alt=""
      aria-hidden
      className="size-4"
      height={16}
      src="/google-calendar.svg"
      width={16}
    />
  ),
  linear: (
    <img
      alt=""
      aria-hidden
      className="size-4 invert dark:invert-0"
      height={16}
      src="/linear.svg"
      width={16}
    />
  ),
} as const;

type ConnectorSummary = NonNullable<
  Awaited<
    ReturnType<
      NonNullable<ReturnType<typeof connectorsQueryOptions>["queryFn"]>
    >
  >
>["connectors"][number];

const getConnectorDescription = (
  connector: ConnectorSummary,
  isConnected: boolean,
  needsReconnect: boolean,
  accountSummary: string
) => {
  if (isConnected) {
    if (accountSummary !== "") {
      return `Connected as ${accountSummary}.`;
    }
    return "Connected.";
  }
  if (needsReconnect) {
    return "Reconnect this service before using its actions.";
  }
  if (connector.isConfigured) {
    return connector.description;
  }
  return "This connector is not available in this environment.";
};

export const ConnectorsSettingsPanel = () => {
  const queryClient = useQueryClient();
  const [startingProvider, setStartingProvider] =
    useState<ConnectorProvider | null>(null);
  const { data, error, isError, isLoading, refetch } = useQuery(
    connectorsQueryOptions()
  );
  const disconnectConnectorMutation = useMutation({
    ...orpc.connectors.disconnect.mutationOptions(),
    mutationKey: ["connectors", "disconnect"],
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY });
      toast.success("Connector disconnected.");
    },
  });

  const startConnection = async (provider: ConnectorProvider) => {
    setStartingProvider(provider);
    try {
      await openConnectorLink({
        provider,
        returnTo: getSettingsReturnTo(),
      });
    } catch (connectionError) {
      setStartingProvider(null);
      toast.error(
        connectionError instanceof Error
          ? connectionError.message
          : "Could not start connector setup."
      );
    }
  };

  const connectors = data?.connectors ?? [];

  const renderContent = () => {
    if (isError && connectors.length === 0) {
      return (
        <SettingsErrorState
          message={error.message ?? "Could not load connectors."}
          onRetry={() => {
            runDetached(async () => {
              await refetch();
            });
          }}
        />
      );
    }
    if (isLoading && connectors.length === 0) {
      return <SettingsLoadingState label="Loading connectors" />;
    }
    return (
      <SettingsRows>
        {connectors.map((connector) => {
          const isConnected = connector.status === "connected";
          const needsReconnect = connector.status === "needs_reconnect";
          const isStarting = startingProvider === connector.provider;
          const accountSummary = connector.accounts
            .map((account) => {
              let workspace = "";
              if ((account.providerWorkspaceName ?? "") !== "") {
                workspace = `${account.providerWorkspaceName}: `;
              }
              return `${workspace}${account.accountEmail ?? account.displayName ?? "Connected"}`;
            })
            .join(", ");
          const isDisconnecting =
            disconnectConnectorMutation.isPending &&
            disconnectConnectorMutation.variables?.provider ===
              connector.provider;

          return (
            <SettingsRow
              action={
                isConnected ? (
                  <Button
                    disabled={isDisconnecting}
                    onClick={() => {
                      disconnectConnectorMutation.mutate({
                        provider: connector.provider,
                      });
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isDisconnecting ? (
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4 animate-spin"
                        icon={Loading03Icon}
                      />
                    ) : null}
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    disabled={!connector.isConfigured || isStarting}
                    onClick={() => {
                      runDetached(async () => {
                        await startConnection(connector.provider);
                      });
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isStarting ? (
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4 animate-spin"
                        icon={Loading03Icon}
                      />
                    ) : null}
                    {needsReconnect ? "Reconnect" : "Connect"}
                  </Button>
                )
              }
              icon={connectorIcons[connector.provider]}
              key={connector.provider}
              title={connector.displayName}
            >
              {getConnectorDescription(
                connector,
                isConnected,
                needsReconnect,
                accountSummary
              )}
            </SettingsRow>
          );
        })}
      </SettingsRows>
    );
  };

  return (
    <SettingsSection
      description="Connect outside services to add mail actions and optional chat capabilities."
      title="Services"
    >
      {renderContent()}
    </SettingsSection>
  );
};
