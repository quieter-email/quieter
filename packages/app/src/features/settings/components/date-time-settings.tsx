"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";

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

const TIME_FORMAT_OPTIONS = [
  { label: "12-hour (1:00 PM)", value: "12h" },
  { label: "24-hour (13:00)", value: "24h" },
] as const;
const WEEK_START_OPTIONS = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 0 },
] as const;

export const DateTimeSettings = () => {
  const { data, isError, error, refetch } = useAccountPreferences();
  const mutation = useUpdateAccountPreferences("date-time-settings");

  return (
    <SettingsSection title="Date and time">
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
            title="Time format"
            action={
              <Select
                items={TIME_FORMAT_OPTIONS}
                value={data?.timeFormat ?? null}
                disabled={data === undefined}
                onValueChange={(value) => {
                  const option = TIME_FORMAT_OPTIONS.find(
                    (item) => item.value === value
                  );
                  if (option) {
                    mutation.mutate({ timeFormat: option.value });
                  }
                }}
              >
                <SelectTrigger
                  aria-label="Time format"
                  className="w-44"
                  size="sm"
                >
                  <SelectValue placeholder="Time format" />
                </SelectTrigger>
                <SelectContent align="end">
                  {TIME_FORMAT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Start of week"
            action={
              <Select
                items={WEEK_START_OPTIONS}
                value={data?.weekStartsOn ?? null}
                disabled={data === undefined}
                onValueChange={(value) => {
                  const option = WEEK_START_OPTIONS.find(
                    (item) => item.value === value
                  );
                  if (option) {
                    mutation.mutate({ weekStartsOn: option.value });
                  }
                }}
              >
                <SelectTrigger
                  aria-label="Start of week"
                  className="w-44"
                  size="sm"
                >
                  <SelectValue placeholder="Start of week" />
                </SelectTrigger>
                <SelectContent align="end">
                  {WEEK_START_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </SettingsRows>
      )}
    </SettingsSection>
  );
};
