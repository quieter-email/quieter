"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  CONNECTORS_QUERY_KEY,
  connectorsQueryOptions,
  openConnectorLink,
  type ConnectorProvider,
} from "~/lib/connectors-query";
import { orpc } from "~/lib/orpc";
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-layout";

const getSettingsReturnTo = () => "/settings?tab=connectors";

const connectorIcons = {
  google_calendar: (
    <img alt="" aria-hidden className="size-4" height={16} src="/google-calendar.svg" width={16} />
  ),
  linear: (
    <span
      aria-hidden
      className="flex size-4 items-center justify-center rounded-[5px] bg-[#5e6ad2] text-[10px] font-medium text-white"
    >
      L
    </span>
  ),
} as const;

export const ConnectorsSettingsPanel = () => {
  const queryClient = useQueryClient();
  const [startingProvider, setStartingProvider] = useState<ConnectorProvider | null>(null);
  const { data, isLoading } = useQuery(connectorsQueryOptions());
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
    } catch (error) {
      setStartingProvider(null);
      toast.error(error instanceof Error ? error.message : "Could not start connector setup.");
    }
  };

  const connectors = data?.connectors ?? [];

  return (
    <SettingsSection
      description="Connect outside services to add mail actions and optional chat capabilities."
      title="Services"
    >
      <SettingsRows>
        {isLoading && connectors.length === 0 ? (
          <SettingsRow
            icon={<HugeiconsIcon aria-hidden className="animate-spin" icon={Loading03Icon} />}
            title="Loading connectors"
          >
            Checking connected services.
          </SettingsRow>
        ) : null}

        {connectors.map((connector) => {
          const isConnected = connector.status === "connected";
          const needsReconnect = connector.status === "needs_reconnect";
          const isStarting = startingProvider === connector.provider;
          const accountSummary = connector.accounts
            .map((account) => {
              const workspace = account.providerWorkspaceName
                ? `${account.providerWorkspaceName}: `
                : "";
              return `${workspace}${account.accountEmail ?? account.displayName ?? "Connected"}`;
            })
            .join(", ");
          const isDisconnecting =
            disconnectConnectorMutation.isPending &&
            disconnectConnectorMutation.variables?.provider === connector.provider;

          return (
            <SettingsRow
              action={
                isConnected ? (
                  <Button
                    disabled={isDisconnecting}
                    onClick={() =>
                      disconnectConnectorMutation.mutate({ provider: connector.provider })
                    }
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
                    onClick={() => void startConnection(connector.provider)}
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
              {isConnected
                ? `Connected${accountSummary ? ` as ${accountSummary}` : ""}.`
                : needsReconnect
                  ? "Reconnect this service before using its actions."
                  : connector.isConfigured
                    ? connector.description
                    : "This connector is not available in this environment."}
            </SettingsRow>
          );
        })}
      </SettingsRows>
    </SettingsSection>
  );
};
