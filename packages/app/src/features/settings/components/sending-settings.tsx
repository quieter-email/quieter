"use client";

import { Switch, SwitchThumb } from "@quieter/ui/switch";

import {
  useAccountPreferences,
  useUpdateAccountPreferences,
} from "./account-date-time-provider";
import {
  SettingsErrorState,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-layout";

export const SendingSettings = () => {
  const { data, isError, error, refetch } = useAccountPreferences();
  const mutation = useUpdateAccountPreferences("sending-settings");

  return (
    <SettingsSection title="Sending">
      {isError && data === undefined ? (
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
                checked={data?.undoSendEnabled ?? true}
                className="shrink-0"
                disabled={data === undefined}
                id="undo-send-toggle"
                onCheckedChange={(undoSendEnabled) => {
                  mutation.mutate({ undoSendEnabled });
                }}
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
