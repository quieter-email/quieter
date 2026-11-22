"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  SettingsErrorState,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-layout";

export const SendingSettings = () => {
  const queryClient = useQueryClient();
  const options = orpc.accountPreferences.get.queryOptions();
  const { data, isPending, isError, error, refetch } = useQuery(options);
  const mutation = useMutation({
    ...orpc.accountPreferences.update.mutationOptions(),
    onError: (mutationError) => {
      toastError(mutationError, { boundary: "sending-settings" });
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(options.queryKey, preferences);
    },
  });
  const pendingUndoSendEnabled = mutation.isPending
    ? mutation.variables.undoSendEnabled
    : undefined;

  return (
    <SettingsSection title="Sending">
      {isError ? (
        <SettingsErrorState
          message={error.message}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : (
        <SettingsRows>
          <SettingsRow
            action={
              <Switch
                aria-label="Undo Send"
                checked={
                  pendingUndoSendEnabled ?? data?.undoSendEnabled ?? true
                }
                className="shrink-0"
                id="undo-send-toggle"
                onCheckedChange={(undoSendEnabled) => {
                  mutation.mutate({ undoSendEnabled });
                }}
                pending={isPending || mutation.isPending}
                size="sm"
              >
                <SwitchThumb />
              </Switch>
            }
            title="Undo Send"
          >
            Hold each message for 5 seconds after you send it, so you can undo
            it. When off, messages send immediately and cannot be undone.
            Scheduled messages are not affected.
          </SettingsRow>
        </SettingsRows>
      )}
    </SettingsSection>
  );
};
