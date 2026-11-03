"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { runDetached } from "@quieter/app/features/settings/components/mailboxes-settings-shared";
import {
  SettingsErrorState,
  SettingsLoadingState,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "@quieter/app/features/settings/components/settings-layout";
import { getConnectorIcon } from "@quieter/app/lib/connector-icons";
import {
  CONNECTORS_QUERY_KEY,
  connectorsQueryOptions,
  openConnectorLink,
} from "@quieter/app/lib/connectors-query";
import type { ConnectorProvider } from "@quieter/app/lib/connectors-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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

export const ConnectorsSettingsPanel = () => {
  const queryClient = useQueryClient();
  const [startingConnection, setStartingConnection] = useState<string | null>(
    null
  );
  const { data, error, isError, isLoading, refetch } = useQuery(
    connectorsQueryOptions()
  );
  const disconnectConnectorMutation = useMutation({
    ...orpc.connectors.disconnect.mutationOptions(),
    mutationKey: ["connectors", "disconnect"],
    onError: (disconnectError) => {
      toastError(disconnectError, { boundary: "connectors" });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      ]);
      toast.success("Connector disconnected.");
    },
  });

  const startConnection = async (
    provider: ConnectorProvider,
    connectionId?: string
  ) => {
    setStartingConnection(connectionId ?? provider);
    try {
      await openConnectorLink({
        connectionId,
        provider,
        returnTo: getSettingsReturnTo(),
      });
    } catch (connectionError) {
      toastError(connectionError, {
        boundary: "connectors",
        fallback: "Could not start connector setup.",
      });
    } finally {
      setStartingConnection(null);
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
        {connectors.map((connector) => (
          <div key={connector.provider}>
            <SettingsRow
              action={
                <Button
                  disabled={
                    !connector.isConfigured || startingConnection !== null
                  }
                  onClick={() => {
                    runDetached(async () => {
                      await startConnection(connector.provider);
                    });
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {startingConnection === connector.provider ? (
                    <Icon aria-hidden animation="spin" icon={Loading03Icon} />
                  ) : null}
                  {connector.accounts.length > 0 ? "Add account" : "Connect"}
                </Button>
              }
              icon={<ConnectorIcon provider={connector.provider} />}
              title={connector.displayName}
            >
              {connector.isConfigured
                ? connector.description
                : "This connector is not available in this environment."}
            </SettingsRow>
            {connector.accounts.map((account) => {
              const isDisconnecting =
                disconnectConnectorMutation.isPending &&
                disconnectConnectorMutation.variables?.connectionId ===
                  account.id;
              const accountLabel =
                [
                  account.providerWorkspaceName,
                  account.accountEmail ?? account.displayName,
                ]
                  .filter(Boolean)
                  .join(": ") || "Connected account";
              return (
                <SettingsRow
                  action={
                    <div className="flex gap-2">
                      <Button
                        disabled={
                          !connector.isConfigured || startingConnection !== null
                        }
                        onClick={() => {
                          runDetached(async () => {
                            await startConnection(
                              connector.provider,
                              account.id
                            );
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {startingConnection === account.id ? (
                          <Icon
                            aria-hidden
                            animation="spin"
                            icon={Loading03Icon}
                          />
                        ) : null}
                        Reconnect
                      </Button>
                      <Button
                        disabled={isDisconnecting}
                        onClick={() => {
                          disconnectConnectorMutation.mutate({
                            connectionId: account.id,
                            provider: connector.provider,
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        {isDisconnecting ? (
                          <Icon
                            aria-hidden
                            animation="spin"
                            icon={Loading03Icon}
                          />
                        ) : null}
                        Disconnect
                      </Button>
                    </div>
                  }
                  key={account.id}
                  title={accountLabel}
                >
                  {account.status === "connected"
                    ? "Connected."
                    : "Reconnect this account to use it."}
                </SettingsRow>
              );
            })}
          </div>
        ))}
      </SettingsRows>
    );
  };

  return (
    <SettingsSection
      description="Connect outside services to use them in chat."
      title="Services"
    >
      {renderContent()}
    </SettingsSection>
  );
};
