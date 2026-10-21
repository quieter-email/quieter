"use client";

import {
  SettingsCard,
  SettingsErrorState,
  SettingsFieldRow,
  SettingsLoadingState,
  SettingsRow,
  SettingsSection,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type BriefSettings = RouterOutputs["dailyBrief"]["get"]["settings"];

const cadenceItems = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
];
const weekdayItems = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 0 },
];

const MailboxBriefForm = ({
  needsReconnect,
  onSave,
  pending,
  settings,
}: {
  needsReconnect: boolean;
  onSave: (settings: BriefSettings) => void;
  pending: boolean;
  settings: BriefSettings;
}) => {
  const [draft, setDraft] = useState(settings);
  const scheduleDisabled =
    pending || needsReconnect || !draft.enabled || !draft.scheduleEnabled;
  const timeZoneItems = [
    ...new Set([
      "UTC",
      settings.timeZone,
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  ]
    .toSorted()
    .map((value) => ({ label: value.replaceAll("_", " "), value }));
  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <SettingsCard>
        <SettingsRow
          action={
            <Switch
              aria-label="Enable Brief for this mailbox"
              checked={draft.enabled}
              disabled={pending || (needsReconnect && !settings.enabled)}
              onCheckedChange={(enabled) => {
                setDraft((previous) => ({ ...previous, enabled }));
              }}
              size="sm"
            >
              <SwitchThumb />
            </Switch>
          }
          title="Enable Brief"
        >
          Keep a personal summary of the important mail in this mailbox.
        </SettingsRow>
        <SettingsRow
          action={
            <Switch
              aria-label="Prepare Brief on a schedule"
              checked={draft.scheduleEnabled}
              disabled={pending || needsReconnect || !draft.enabled}
              onCheckedChange={(scheduleEnabled) => {
                setDraft((previous) => ({ ...previous, scheduleEnabled }));
              }}
              size="sm"
            >
              <SwitchThumb />
            </Switch>
          }
          title="Scheduled editions"
        >
          Have a fresh edition ready at your chosen time.
        </SettingsRow>
        <SettingsFieldRow
          action={
            <Select
              disabled={scheduleDisabled}
              items={cadenceItems}
              onValueChange={(cadence) => {
                if (cadence === "daily" || cadence === "weekly") {
                  setDraft((previous) => ({ ...previous, cadence }));
                }
              }}
              value={draft.cadence}
            >
              <SelectTrigger
                aria-label="Brief frequency"
                size="sm"
                variant="ghost"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {cadenceItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          }
          label="Frequency"
          value="Choose a daily or weekly edition."
        />
        {draft.cadence === "weekly" && (
          <SettingsFieldRow
            action={
              <Select
                disabled={scheduleDisabled}
                items={weekdayItems}
                onValueChange={(weekday) => {
                  if (typeof weekday === "number") {
                    setDraft((previous) => ({ ...previous, weekday }));
                  }
                }}
                value={draft.weekday}
              >
                <SelectTrigger aria-label="Brief day" size="sm" variant="ghost">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectGroup>
                    {weekdayItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            }
            label="Day"
            value="The day your weekly edition is prepared."
          />
        )}
        <SettingsFieldRow
          action={
            <Input
              aria-label="Brief local time"
              disabled={scheduleDisabled}
              onChange={(event) => {
                const localTime = event.currentTarget.value;
                setDraft((previous) => ({ ...previous, localTime }));
              }}
              required
              size="sm"
              type="time"
              value={draft.localTime}
            />
          }
          label="Time"
          value="Use the local time in your selected timezone."
        />
        <SettingsFieldRow
          action={
            <Select
              disabled={scheduleDisabled}
              items={timeZoneItems}
              onValueChange={(timeZone) => {
                if (typeof timeZone === "string") {
                  setDraft((previous) => ({ ...previous, timeZone }));
                }
              }}
              value={draft.timeZone}
            >
              <SelectTrigger
                aria-label="Brief timezone"
                className="max-w-56"
                size="sm"
                variant="ghost"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectList>
                  <SelectGroup>
                    {timeZoneItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectList>
              </SelectContent>
            </Select>
          }
          label="Timezone"
          value="The schedule follows daylight saving changes."
        />
        <div className={settingsSurfaceVariants({ variant: "footer" })}>
          <p className="text-caption text-muted-fg">
            {needsReconnect
              ? "Reconnect this mailbox to prepare new editions."
              : "These preferences apply only to your Brief."}
          </p>
          <ActionFooter>
            <Button
              disabled={!isDirty || pending}
              pending={pending}
              pendingLabel="Saving…"
              size="sm"
              type="submit"
            >
              Save preferences
            </Button>
          </ActionFooter>
        </div>
      </SettingsCard>
    </form>
  );
};

export const MailboxBriefSettings = ({
  mailbox,
}: {
  mailbox: { connectionStatus: string; id: string };
}) => {
  const queryClient = useQueryClient();
  const queryOptions = orpc.dailyBrief.get.queryOptions({
    input: { mailboxId: mailbox.id },
  });
  const query = useQuery(queryOptions);
  const configure = useMutation({
    ...orpc.dailyBrief.configure.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "mailbox-brief-settings" });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryOptions.queryKey, data);
    },
  });

  return (
    <SettingsSection
      description="Choose when to prepare your summary for this mailbox. Editions stay in Quieter."
      title="Brief"
    >
      {query.isPending ? (
        <SettingsLoadingState label="Loading Brief settings" />
      ) : null}
      {query.isError && query.data === undefined ? (
        <SettingsErrorState
          message="Could not load Brief settings."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {query.data ? (
        <MailboxBriefForm
          key={`${mailbox.id}:${JSON.stringify(query.data.settings)}`}
          needsReconnect={mailbox.connectionStatus === "needs_reconnect"}
          onSave={(settings) => {
            configure.mutate({
              cadence: settings.cadence,
              enabled: settings.enabled,
              localTime: settings.localTime,
              mailboxId: mailbox.id,
              scheduleEnabled: settings.scheduleEnabled,
              timeZone: settings.timeZone,
              weekday: settings.weekday,
            });
          }}
          pending={configure.isPending}
          settings={query.data.settings}
        />
      ) : null}
    </SettingsSection>
  );
};
