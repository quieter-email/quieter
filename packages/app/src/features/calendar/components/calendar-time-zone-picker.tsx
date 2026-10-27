"use client";

import { SearchableSelect } from "@quieter/ui/searchable-select";
import type { SearchableSelectProps } from "@quieter/ui/searchable-select";
import { useMemo } from "react";

import { getCalendarTimeZoneOptions } from "../domain/calendar-event-form";

export type CalendarTimeZonePickerProps = Omit<
  SearchableSelectProps,
  "emptyMessage" | "options" | "searchPlaceholder"
>;

export const CalendarTimeZonePicker = ({
  "aria-label": ariaLabel = "Time zone",
  value,
  ...props
}: CalendarTimeZonePickerProps) => {
  const options = useMemo(
    () =>
      getCalendarTimeZoneOptions(value).map((option) => ({
        ...option,
        description: option.label,
        label: option.label.split("/").at(-1) ?? option.label,
      })),
    [value]
  );

  return (
    <SearchableSelect
      aria-label={ariaLabel}
      emptyMessage="No time zones found. Try a city or region."
      options={options}
      searchPlaceholder="Search city or time zone"
      value={value}
      {...props}
    />
  );
};
