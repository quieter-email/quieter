"use client";

import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { Button } from "@quieter/ui/button";
import { SpinnerIcon } from "@quieter/ui/spinner-icon";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  SettingsCard,
  SettingsFieldRow,
  SettingsSection,
} from "./settings-layout";

const connectionsSchema = z.array(
  z.object({
    clientId: z.string(),
    connectedAt: z.coerce.date(),
    name: z.string(),
  })
);
const connectedAtFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

export const ConnectedAppsSettings = ({ userId }: { userId: string }) => {
  const queryClient = useQueryClient();
  const queryKey = ["auth", "connected-apps", userId];
  const connectionsQuery = useQuery({
    queryFn: async () =>
      connectionsSchema.parse(
        await authClient.$fetch("/oauth2/connections", { throw: true })
      ),
    queryKey,
  });
  const disconnectMutation = useMutation({
    mutationFn: async (clientId: string) => {
      await authClient.$fetch("/oauth2/disconnect", {
        body: { clientId },
        method: "POST",
        throw: true,
      });
    },
    mutationKey: ["auth", "connected-apps", "disconnect"],
    onError: (error) => {
      toastError(error, { boundary: "connected-apps" });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success("App disconnected.");
    },
  });
  const connections = connectionsQuery.data ?? [];

  if (connections.length === 0 && !connectionsQuery.isError) {
    return null;
  }

  return (
    <SettingsSection
      description="Apps that can act as you in quieter."
      title="Connected apps"
    >
      <SettingsCard>
        {connectionsQuery.isError && (
          <SettingsFieldRow
            action={
              <Button
                disabled={connectionsQuery.isFetching}
                onClick={() => {
                  void connectionsQuery.refetch();
                }}
                size="sm"
                variant="secondary"
              >
                Retry
              </Button>
            }
            label="Could not load connected apps"
            value="Try again to view or disconnect your apps."
          />
        )}
        {connections.map((connection) => {
          const isDisconnecting =
            disconnectMutation.isPending &&
            disconnectMutation.variables === connection.clientId;
          return (
            <SettingsFieldRow
              action={
                <Button
                  disabled={disconnectMutation.isPending}
                  onClick={() => {
                    disconnectMutation.mutate(connection.clientId);
                  }}
                  size="sm"
                  variant="destructive"
                >
                  {isDisconnecting && <SpinnerIcon />}
                  Disconnect
                </Button>
              }
              key={connection.clientId}
              label={connection.name}
              value={`Connected ${connectedAtFormatter.format(connection.connectedAt)}`}
            />
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
};
