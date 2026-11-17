import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type { CalendarEvent, CalendarSummary } from "./contracts";
import { calendarRefSchema, calendarTimeZoneSchema } from "./contracts";

const instantSchema = z.iso.datetime({ offset: true }).refine((value) => {
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}, "Enter a valid time.");

const workingHoursSchema = z
  .array(
    z
      .object({
        endMinute: z.number().int().min(1).max(1440),
        startMinute: z.number().int().min(0).max(1439),
        weekday: z.number().int().min(1).max(7),
      })
      .strict()
      .refine((window) => window.startMinute < window.endMinute, {
        message: "Working hours must end after they start.",
        path: ["endMinute"],
      })
  )
  .min(1)
  .max(14)
  .refine(
    (windows) =>
      windows.every((window, index) =>
        windows
          .slice(0, index)
          .every(
            (previous) =>
              previous.weekday !== window.weekday ||
              previous.endMinute <= window.startMinute ||
              window.endMinute <= previous.startMinute
          )
      ),
    "Working hours on the same day must not overlap."
  );

export const calendarAvailabilityInputSchema = z
  .object({
    calendars: z
      .array(calendarRefSchema)
      .min(1)
      .max(10)
      .refine(
        (calendars) =>
          calendars.every((calendar, index) =>
            calendars
              .slice(0, index)
              .every(
                (previous) =>
                  previous.calendarId !== calendar.calendarId ||
                  previous.connectionId !== calendar.connectionId
              )
          ),
        "Choose each calendar only once."
      ),
    end: instantSchema,
    limit: z.number().int().min(1).max(50).default(10),
    preferences: z
      .object({
        bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
        bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
        durationMinutes: z.number().int().min(5).max(480),
        stepMinutes: z.number().int().min(5).max(120).default(15),
        workingHours: workingHoursSchema,
      })
      .strict(),
    start: instantSchema,
    timeZone: calendarTimeZoneSchema,
  })
  .strict()
  .refine((input) => {
    try {
      const duration =
        Temporal.Instant.from(input.end).epochNanoseconds -
        Temporal.Instant.from(input.start).epochNanoseconds;
      return (
        duration > 0n && duration <= 31n * 24n * 60n * 60n * 1_000_000_000n
      );
    } catch {
      return false;
    }
  }, "Choose a date range of up to 31 days.");

const candidateSchema = z
  .object({
    end: instantSchema,
    start: instantSchema,
    timeZone: calendarTimeZoneSchema,
  })
  .strict()
  .refine((candidate) => {
    try {
      return Temporal.Instant.compare(candidate.start, candidate.end) < 0;
    } catch {
      return false;
    }
  }, "A proposed time must end after it starts.");

const coverageSchema = z.discriminatedUnion("status", [
  z
    .object({ calendar: calendarRefSchema, status: z.literal("complete") })
    .strict(),
  z
    .object({
      calendar: calendarRefSchema,
      reason: z.enum([
        "reconnect",
        "permission",
        "not-found",
        "temporary",
        "unsupported",
      ]),
      status: z.literal("unavailable"),
    })
    .strict(),
]);

export const calendarAvailabilityResultSchema = z
  .object({
    candidates: z.array(candidateSchema).max(50),
    checkedAt: instantSchema,
    coverage: z.array(coverageSchema).min(1).max(10),
    explanation: z.string().min(1).max(1000),
    status: z.enum(["complete", "partial", "unavailable"]),
    timeZone: calendarTimeZoneSchema,
  })
  .strict()
  .refine((result) => {
    const complete = result.coverage.filter(
      (calendar) => calendar.status === "complete"
    ).length;
    let status: "complete" | "partial" | "unavailable" = "partial";
    if (complete === result.coverage.length) {
      status = "complete";
    } else if (complete === 0) {
      status = "unavailable";
    }
    return (
      result.status === status &&
      (status === "complete" || result.candidates.length === 0)
    );
  }, "Availability must reflect the calendars that were checked.");

export type CalendarAvailabilityInput = z.infer<
  typeof calendarAvailabilityInputSchema
>;
export type CalendarAvailabilityResult = z.infer<
  typeof calendarAvailabilityResultSchema
>;
export type CalendarAvailabilitySnapshot = {
  calendar: CalendarSummary;
  events: CalendarEvent[];
};

type Interval = { start: bigint; end: bigint };

const getWorkingWindow = ({
  date,
  timeZone,
  window,
}: {
  date: Temporal.PlainDate;
  timeZone: string;
  window: CalendarAvailabilityInput["preferences"]["workingHours"][number];
}): Interval | null => {
  try {
    const midnight = date.toPlainDateTime();
    return {
      end: midnight
        .add({ minutes: window.endMinute })
        .toZonedDateTime(timeZone, { disambiguation: "reject" })
        .epochNanoseconds,
      start: midnight
        .add({ minutes: window.startMinute })
        .toZonedDateTime(timeZone, { disambiguation: "reject" })
        .epochNanoseconds,
    };
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
};

export const calculateCalendarAvailability = ({
  busyIntervals = [],
  calendars,
  input,
}: {
  busyIntervals?: readonly Pick<CalendarAvailabilityInput, "start" | "end">[];
  calendars: CalendarAvailabilitySnapshot[];
  input: CalendarAvailabilityInput;
}): CalendarAvailabilityResult["candidates"] => {
  const { preferences, timeZone } = input;
  const minute = 60n * 1_000_000_000n;
  const before = BigInt(preferences.bufferBeforeMinutes) * minute;
  const after = BigInt(preferences.bufferAfterMinutes) * minute;
  const duration = BigInt(preferences.durationMinutes) * minute;
  const occupied: Interval[] = [];
  for (const interval of busyIntervals) {
    const start = Temporal.Instant.from(interval.start).epochNanoseconds;
    const end = Temporal.Instant.from(interval.end).epochNanoseconds;
    if (end <= start) {
      throw new RangeError("Busy intervals must end after they start.");
    }
    occupied.push({ end: end + before, start: start - after });
  }
  for (const snapshot of calendars) {
    for (const event of snapshot.events) {
      if (
        event.status === "cancelled" ||
        event.availability === "free" ||
        event.attendees.some(
          (attendee) => attendee.self && attendee.response === "declined"
        )
      ) {
        continue;
      }
      const { time } = event;
      const sourceZone = time.timeZone ?? snapshot.calendar.timeZone;
      const start =
        time.kind === "timed"
          ? Temporal.Instant.from(time.start).epochNanoseconds
          : Temporal.PlainDate.from(time.startDate).toZonedDateTime(sourceZone)
              .epochNanoseconds;
      const end =
        time.kind === "timed"
          ? Temporal.Instant.from(time.end).epochNanoseconds
          : Temporal.PlainDate.from(time.endDate).toZonedDateTime(sourceZone)
              .epochNanoseconds;
      if (end > start) {
        occupied.push({ end: end + before, start: start - after });
      }
    }
  }
  occupied.sort((left, right) => {
    if (left.start === right.start) {
      return 0;
    }
    return left.start < right.start ? -1 : 1;
  });
  const merged: Interval[] = [];
  for (const interval of occupied) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) {
      if (interval.end > previous.end) {
        previous.end = interval.end;
      }
    } else {
      merged.push(interval);
    }
  }

  const horizonStart = Temporal.Instant.from(input.start);
  const horizonEnd = Temporal.Instant.from(input.end);
  const firstDate = horizonStart.toZonedDateTimeISO(timeZone).toPlainDate();
  const lastDate = horizonEnd.toZonedDateTimeISO(timeZone).toPlainDate();
  const dateCount = firstDate.until(lastDate, { largestUnit: "day" }).days + 1;
  const starts = new Set<bigint>();
  for (let day = 0; day < dateCount; day += 1) {
    const date = firstDate.add({ days: day });
    for (const window of preferences.workingHours) {
      if (window.weekday !== date.dayOfWeek) {
        continue;
      }
      const bounds = getWorkingWindow({ date, timeZone, window });
      if (!bounds) {
        continue;
      }
      for (
        let wallMinute = window.startMinute;
        wallMinute < window.endMinute;
        wallMinute += preferences.stepMinutes
      ) {
        let start: bigint;
        try {
          start = date
            .toPlainDateTime()
            .add({ minutes: wallMinute })
            .toZonedDateTime(timeZone, {
              disambiguation: "reject",
            }).epochNanoseconds;
        } catch (error) {
          if (error instanceof RangeError) {
            continue;
          }
          throw error;
        }
        const end = start + duration;
        if (
          start >= bounds.start &&
          end <= bounds.end &&
          start >= horizonStart.epochNanoseconds &&
          end <= horizonEnd.epochNanoseconds
        ) {
          starts.add(start);
        }
      }
    }
  }

  const candidates: CalendarAvailabilityResult["candidates"] = [];
  let occupiedIndex = 0;
  for (const start of [...starts].toSorted((left, right) => {
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  })) {
    const end = start + duration;
    let busy = merged.at(occupiedIndex);
    while (busy && busy.end <= start) {
      occupiedIndex += 1;
      busy = merged.at(occupiedIndex);
    }
    if (busy && busy.start < end) {
      continue;
    }
    candidates.push({
      end: Temporal.Instant.fromEpochNanoseconds(end).toString(),
      start: Temporal.Instant.fromEpochNanoseconds(start).toString(),
      timeZone,
    });
    if (candidates.length === input.limit) {
      break;
    }
  }
  return candidates;
};
