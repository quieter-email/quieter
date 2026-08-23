"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { runDetached } from "#/features/settings/components/mailboxes-settings-shared";
import { getConnectorIcon } from "#/lib/connector-icons";
import {
  CONNECTORS_QUERY_KEY,
  connectorsQueryOptions,
  openConnectorLink,
} from "#/lib/connectors-query";
import type { ConnectorProvider } from "#/lib/connectors-query";
import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";

import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-layout";

const getSettingsReturnTo = () => "/settings?tab=connectors";

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
      toastError(connectionError, {
        boundary: "connectors",
        fallback: "Could not start connector setup.",
      });
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
              icon={<ConnectorIcon provider={connector.provider} />}
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
