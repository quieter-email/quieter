import type { CalendarSummary } from "@quieter/calendar";
import { calendarAvailabilityInputSchema } from "@quieter/calendar/availability";
import type { CalendarAvailabilityInput } from "@quieter/calendar/availability";
import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";

import { addCalendarDays, getCalendarRefKey } from "./calendar-event-form";

export type CalendarAvailabilityForm = {
  bufferAfter: string;
  bufferBefore: string;
  calendarKeys: string[];
  duration: string;
  endDate: string;
  hoursEnd: string;
  hoursStart: string;
  startDate: string;
  timeZone: string;
  weekdays: number[];
};

type CalendarAvailabilityFormResult<T> =
  | { kind: "valid"; value: T }
  | { kind: "invalid"; message: string };

export const createCalendarAvailabilityForm = ({
  instant = new Date().toISOString(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: { instant?: string; timeZone?: string } = {}): CalendarAvailabilityForm => {
  const today = getZonedDateTimeFields({ instant, timeZone }).date;
  return {
    bufferAfter: "0",
    bufferBefore: "0",
    calendarKeys: [],
    duration: "30",
    endDate: addCalendarDays(today, 7),
    hoursEnd: "17:00",
    hoursStart: "09:00",
    startDate: addCalendarDays(today, 1),
    timeZone,
    weekdays: [1, 2, 3, 4, 5],
  };
};

export const parseCalendarAvailabilityForm = ({
  calendars,
  form,
}: {
  calendars: CalendarSummary[];
  form: CalendarAvailabilityForm;
}): CalendarAvailabilityFormResult<CalendarAvailabilityInput> => {
  const selectedCalendars = calendars.filter((calendar) =>
    form.calendarKeys.includes(getCalendarRefKey(calendar))
  );
  if (
    form.calendarKeys.some(
      (key) =>
        !selectedCalendars.some(
          (calendar) => getCalendarRefKey(calendar) === key
        )
    )
  ) {
    return {
      kind: "invalid",
      message:
        "A selected calendar is no longer available. Review the calendars to check.",
    };
  }
  try {
    const startMinute =
      Number(form.hoursStart.slice(0, 2)) * 60 +
      Number(form.hoursStart.slice(3, 5));
    const endMinute =
      Number(form.hoursEnd.slice(0, 2)) * 60 +
      Number(form.hoursEnd.slice(3, 5));
    const request = calendarAvailabilityInputSchema.safeParse({
      calendars: selectedCalendars.map(({ calendarId, connectionId }) => ({
        calendarId,
        connectionId,
      })),
      end: calendarWallTimeToInstant({
        date: addCalendarDays(form.endDate, 1),
        time: "00:00",
        timeZone: form.timeZone,
      }),
      limit: 20,
      preferences: {
        bufferAfterMinutes: Number(form.bufferAfter),
        bufferBeforeMinutes: Number(form.bufferBefore),
        durationMinutes: Number(form.duration),
        stepMinutes: 15,
        workingHours: form.weekdays.map((weekday) => ({
          endMinute,
          startMinute,
          weekday,
        })),
      },
      start: calendarWallTimeToInstant({
        date: form.startDate,
        time: "00:00",
        timeZone: form.timeZone,
      }),
      timeZone: form.timeZone,
    });
    if (!request.success) {
      return {
        kind: "invalid",
        message:
          request.error.issues[0]?.message ??
          "Review the selected calendars and times.",
      };
    }
    return { kind: "valid", value: request.data };
  } catch {
    return {
      kind: "invalid",
      message:
        "A selected time is missing or occurs twice when the clocks change. Choose another time.",
    };
  }
};

export const parseCalendarAvailabilityExpiry = ({
  date,
  end,
  now,
  time,
  timeZone,
}: {
  date: string;
  end: string;
  now: string;
  time: string;
  timeZone: string;
}): CalendarAvailabilityFormResult<string> => {
  let expiresAt: string;
  try {
    expiresAt = calendarWallTimeToInstant({ date, time, timeZone });
  } catch {
    return {
      kind: "invalid",
      message:
        "This expiry time is missing or occurs twice because the clocks change. Choose another time.",
    };
  }
  if (Date.parse(expiresAt) <= Date.parse(now)) {
    return { kind: "invalid", message: "Choose a future expiry time." };
  }
  if (Date.parse(expiresAt) > Date.parse(end)) {
    return {
      kind: "invalid",
      message: "Choose an expiry no later than the end of the available dates.",
    };
  }
  return { kind: "valid", value: expiresAt };
};
