"use client";

import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { DatePicker } from "@quieter/ui/date-picker";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Text } from "@quieter/ui/text";
import { TimePicker } from "@quieter/ui/time-picker";

import type { CalendarAvailabilityForm } from "../domain/calendar-availability-form";
import { getCalendarRefKey } from "../domain/calendar-event-form";
import { CalendarTimeZonePicker } from "./calendar-time-zone-picker";
import type { useCalendarAvailabilityCalendars } from "./use-calendar-availability-calendars";

export const CalendarAvailabilityFields = ({
  disabled = false,
  firstDateLabel = "First proposal date",
  lastDateLabel = "Last proposal date",
  onChange,
  source,
  timeZoneLabel = "Proposal time zone",
  value,
}: {
  disabled?: boolean;
  firstDateLabel?: string;
  lastDateLabel?: string;
  onChange: (patch: Partial<CalendarAvailabilityForm>) => void;
  source: ReturnType<typeof useCalendarAvailabilityCalendars>;
  timeZoneLabel?: string;
  value: CalendarAvailabilityForm;
}) => (
  <>
    <div className="space-y-2">
      <Text as="p" size="sm">
        Calendars to check
      </Text>
      {source.isPending ? (
        <Text size="caption" tone="muted">
          Loading calendars…
        </Text>
      ) : null}
      {source.calendars.map((calendar) => (
        <label
          className="flex min-w-0 items-center gap-2"
          key={getCalendarRefKey(calendar)}
        >
          <Checkbox
            aria-label={`Check ${calendar.name}`}
            checked={value.calendarKeys.includes(getCalendarRefKey(calendar))}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onChange({
                calendarKeys: checked
                  ? [...value.calendarKeys, getCalendarRefKey(calendar)]
                  : value.calendarKeys.filter(
                      (key) => key !== getCalendarRefKey(calendar)
                    ),
              });
            }}
          >
            <CheckboxIndicator />
          </Checkbox>
          <Text size="sm" truncate>
            {calendar.name}
          </Text>
        </label>
      ))}
      {value.calendarKeys
        .filter(
          (key) =>
            !source.calendars.some(
              (calendar) => getCalendarRefKey(calendar) === key
            )
        )
        .map((key, index) => (
          <label className="flex min-w-0 items-center gap-2" key={key}>
            <Checkbox
              aria-label={`Unavailable selected calendar ${index + 1}`}
              checked
              disabled={disabled}
              onCheckedChange={(checked) => {
                if (!checked) {
                  onChange({
                    calendarKeys: value.calendarKeys.filter(
                      (selected) => selected !== key
                    ),
                  });
                }
              }}
            >
              <CheckboxIndicator />
            </Checkbox>
            <Text size="sm" tone="muted">
              Unavailable selected calendar {index + 1}, uncheck to remove
            </Text>
          </label>
        ))}
      {source.hasAttention ? (
        <Text as="p" size="caption" tone="muted">
          Some accounts need attention in Settings. Their calendars are not
          included.
        </Text>
      ) : null}
      {source.isError ? (
        <Button
          disabled={disabled}
          onClick={() => {
            source.retry();
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          Retry calendar access
        </Button>
      ) : null}
      {!source.isPending && source.calendars.length === 0 ? (
        <Text as="p" size="caption" tone="muted">
          Connect a calendar in Settings to find times.
        </Text>
      ) : null}
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel size="caption">From date</FieldLabel>
        <DatePicker
          aria-label={firstDateLabel}
          disabled={disabled}
          onValueChange={(startDate) => {
            onChange({ startDate });
          }}
          value={value.startDate}
        />
      </Field>
      <Field>
        <FieldLabel size="caption">Through date</FieldLabel>
        <DatePicker
          aria-label={lastDateLabel}
          disabled={disabled}
          onValueChange={(endDate) => {
            onChange({ endDate });
          }}
          value={value.endDate}
        />
      </Field>
      <Field>
        <FieldLabel size="caption">Working day starts</FieldLabel>
        <TimePicker
          aria-label="Working day starts"
          disabled={disabled}
          onValueChange={(hoursStart) => {
            onChange({ hoursStart });
          }}
          value={value.hoursStart}
        />
      </Field>
      <Field>
        <FieldLabel size="caption">Working day ends</FieldLabel>
        <TimePicker
          aria-label="Working day ends"
          disabled={disabled}
          onValueChange={(hoursEnd) => {
            onChange({ hoursEnd });
          }}
          value={value.hoursEnd}
        />
      </Field>
    </div>
    <div className="flex flex-wrap gap-1" aria-label="Working weekdays">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => (
        <Button
          aria-pressed={value.weekdays.includes(index + 1)}
          disabled={disabled}
          key={day}
          onClick={() => {
            onChange({
              weekdays: value.weekdays.includes(index + 1)
                ? value.weekdays.filter((weekday) => weekday !== index + 1)
                : [...value.weekdays, index + 1],
            });
          }}
          size="sm"
          type="button"
          variant="option"
        >
          {day}
        </Button>
      ))}
    </div>
    <CalendarTimeZonePicker
      aria-label={timeZoneLabel}
      disabled={disabled}
      onValueChange={(timeZone) => {
        onChange({ timeZone });
      }}
      value={value.timeZone}
    />
    <div className="grid grid-cols-3 gap-3">
      {(
        [
          { field: "duration", label: "Minutes" },
          { field: "bufferBefore", label: "Gap before" },
          { field: "bufferAfter", label: "Gap after" },
        ] as const
      ).map(({ field, label }) => (
        <Field key={field}>
          <FieldLabel size="caption">{label}</FieldLabel>
          <Input
            aria-label={label}
            disabled={disabled}
            min={field === "duration" ? 5 : 0}
            onChange={(event) => {
              onChange({ [field]: event.target.value });
            }}
            type="number"
            value={value[field]}
          />
        </Field>
      ))}
    </div>
  </>
);
