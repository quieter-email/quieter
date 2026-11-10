"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";
import type { ScheduledSendTime } from "@quieter/mail/scheduled-send";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { DatePicker } from "@quieter/ui/date-picker";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { Text } from "@quieter/ui/text";
import { TimePicker } from "@quieter/ui/time-picker";
import { ToolbarButton } from "@quieter/ui/toolbar";
import { useState } from "react";

import { CalendarTimeZonePicker } from "../../calendar/components/calendar-time-zone-picker";
import { getReminderPresetTime } from "../../reminders/reminder-time";

export const ScheduleSendEditor = ({
  initial,
  onCancel,
  onConfirm,
  pending = false,
  submitDisabled = false,
  submitLabel = "Schedule send",
}: {
  initial?: ScheduledSendTime;
  onCancel: () => void;
  onConfirm: (value: ScheduledSendTime) => Promise<void> | void;
  pending?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
}) => {
  const [timeZone, setTimeZone] = useState(
    () => initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [local, setLocal] = useState(() =>
    getZonedDateTimeFields({
      instant: initial?.sendAt ?? getReminderPresetTime({ days: 1, timeZone }),
      timeZone,
    })
  );
  const [error, setError] = useState<string | null>(null);
  // oxlint-disable-next-line react/hook-use-state -- Date bounds stay fixed for this editor lifetime.
  const [now] = useState(() => new Date());
  const latest = new Date(now);
  latest.setUTCFullYear(latest.getUTCFullYear() + 5);
  const submit = () => {
    let sendAt: string;
    try {
      sendAt = calendarWallTimeToInstant({
        ...local,
        disambiguation: "reject",
        timeZone,
      });
    } catch {
      setError(
        "This time is missing or occurs twice because the clocks change. Choose another time."
      );
      return;
    }
    // oxlint-disable-next-line react/purity -- This click handler validates against the time the user confirms.
    if (new Date(sendAt).getTime() < Date.now() + 60_000) {
      setError("Choose a time at least one minute from now.");
      return;
    }
    if (new Date(sendAt).getTime() > latest.getTime()) {
      setError("Choose a date within the next five years.");
      return;
    }
    setError(null);
    void onConfirm({ sendAt, timeZone });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {(
          [
            { days: 1, label: "Tomorrow morning" },
            { days: 7, label: "Next week" },
          ] as const
        ).map((preset) => {
          const fields = getZonedDateTimeFields({
            instant: getReminderPresetTime({ days: preset.days, timeZone }),
            timeZone,
          });
          return (
            <Button
              aria-pressed={
                local.date === fields.date && local.time === fields.time
              }
              disabled={pending}
              key={preset.days}
              onClick={() => {
                setLocal(fields);
                setError(null);
              }}
              size="sm"
              type="button"
              variant="option"
            >
              {preset.label}
            </Button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Field className="min-w-0 flex-1">
          <FieldLabel size="caption">Date</FieldLabel>
          <DatePicker
            aria-label="Send date"
            disabled={pending}
            max={
              getZonedDateTimeFields({
                instant: latest.toISOString(),
                timeZone,
              }).date
            }
            min={
              getZonedDateTimeFields({ instant: now.toISOString(), timeZone })
                .date
            }
            onValueChange={(date) => {
              setLocal((value) => ({ ...value, date }));
              setError(null);
            }}
            required
            value={local.date}
          />
        </Field>
        <Field className="w-28 shrink-0">
          <FieldLabel size="caption">Time</FieldLabel>
          <TimePicker
            aria-label="Send time"
            disabled={pending}
            onValueChange={(time) => {
              setLocal((value) => ({ ...value, time }));
              setError(null);
            }}
            required
            value={local.time}
          />
        </Field>
      </div>
      <div className="space-y-1">
        <CalendarTimeZonePicker
          aria-label="Send time zone"
          disabled={pending}
          onValueChange={(value) => {
            setTimeZone(value);
            setError(null);
          }}
          size="sm"
          value={timeZone}
          variant="ghost"
        />
        <Text as="p" size="caption" tone="muted">
          Sends even when Quieter is closed.
        </Text>
      </div>
      {error ? (
        <Text as="p" role="alert" size="sm" tone="destructive">
          {error}
        </Text>
      ) : null}
      <ActionFooter>
        <Button
          disabled={pending}
          onClick={onCancel}
          size="field"
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={pending || submitDisabled}
          onClick={submit}
          size="field"
          type="button"
        >
          {pending ? "Scheduling…" : submitLabel}
        </Button>
      </ActionFooter>
    </div>
  );
};

export const ComposeScheduleSend = ({
  disabled,
  onSchedule,
  pending,
  preview = false,
}: {
  disabled: boolean;
  onSchedule: (value: ScheduledSendTime) => Promise<void>;
  pending: boolean;
  preview?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <IconButtonTooltip label="Schedule send">
        <PopoverTrigger
          aria-label="Schedule send"
          disabled={disabled}
          render={<ToolbarButton size="icon-sm" type="button" />}
        >
          <Icon icon={ArrowDown01Icon} />
        </PopoverTrigger>
      </IconButtonTooltip>
      <PopoverContent
        align="start"
        aria-label="Schedule send"
        side="top"
        size="sm"
      >
        <div className="space-y-4">
          <PopoverTitle>Schedule send</PopoverTitle>
          {preview ? (
            <Text as="p" size="caption" tone="muted">
              Scheduling is unavailable in this preview.
            </Text>
          ) : null}
          <ScheduleSendEditor
            key={String(open)}
            onCancel={() => {
              setOpen(false);
            }}
            onConfirm={async (value) => {
              try {
                await onSchedule(value);
              } finally {
                setOpen(false);
              }
            }}
            pending={pending}
            submitDisabled={preview}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
