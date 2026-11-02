import { Temporal } from "@js-temporal/polyfill";
import ICAL from "ical.js";

import type { CalendarEventTime } from "./contracts";

export type CalendarRecurrencePreview = {
  times: CalendarEventTime[];
  issue?: string;
};

const unavailable =
  "This repeat rule cannot be previewed. The event will still use the configured repeat rule when saved.";

// Restrict synchronous iteration to shapes whose next occurrence has a finite search.
// ICAL's contracting-rule loop does not check UNTIL while searching for a match.
const canPreviewRule = (rule: ICAL.Recur): boolean => {
  const keys = Object.keys(rule.parts);
  if (
    rule.interval > 10_000 ||
    !Number.isInteger(rule.interval) ||
    rule.interval < 1
  ) {
    return false;
  }
  switch (rule.freq) {
    case "DAILY": {
      return keys.length === 0;
    }
    case "WEEKLY": {
      return (
        keys.every((key) => key === "BYDAY") &&
        rule
          .getComponent("BYDAY")
          .every((day) => /^(?:MO|TU|WE|TH|FR|SA|SU)$/u.test(String(day)))
      );
    }
    case "MONTHLY": {
      if (keys.length > 1) {
        return false;
      }
      if (keys[0] === "BYDAY") {
        return rule
          .getComponent("BYDAY")
          .every((day) =>
            /^(?:[1-5]|-[1-5])(?:MO|TU|WE|TH|FR|SA|SU)$/u.test(String(day))
          );
      }
      return keys.every((key) => key === "BYMONTHDAY");
    }
    case "YEARLY": {
      return (
        keys.every((key) => key === "BYMONTH" || key === "BYMONTHDAY") &&
        rule.getComponent("BYMONTH").length <= 1 &&
        rule.getComponent("BYMONTHDAY").length <= 1 &&
        (keys.length === 0 || keys.length === 2)
      );
    }
    default: {
      return false;
    }
  }
};

export const getCalendarRecurrencePreview = ({
  dates,
  recurrence,
  time,
  timeZone,
}: {
  dates: string[];
  recurrence: string[];
  time: CalendarEventTime;
  timeZone: string;
}): CalendarRecurrencePreview => {
  if (!recurrence.length || !dates.length) {
    return { times: dates.length ? [time] : [] };
  }
  try {
    const sortedDates = dates.toSorted();
    const [first] = sortedDates;
    const last = sortedDates.at(-1);
    if (!first || !last) {
      return { times: [] };
    }
    const firstDate = Temporal.PlainDate.from(first);
    const endDate = Temporal.PlainDate.from(last).add({
      days: 1,
    });
    const rangeStart = firstDate.toZonedDateTime(timeZone).toInstant();
    const rangeEnd = endDate.toZonedDateTime(timeZone).toInstant();
    const eventZone = time.kind === "timed" ? time.timeZone : timeZone;
    const start =
      time.kind === "timed"
        ? Temporal.Instant.from(time.start)
            .toZonedDateTimeISO(eventZone)
            .toPlainDateTime()
            .toString({ smallestUnit: "second" })
        : time.startDate;
    const initial = ICAL.Time.fromString(start, null);
    const limit = ICAL.Time.fromString(
      time.kind === "all-day"
        ? endDate.toString()
        : rangeEnd
            .toZonedDateTimeISO(eventZone)
            .toPlainDateTime()
            .toString({ smallestUnit: "second" }),
      null
    );
    if (
      limit.year - initial.year > 400 ||
      recurrence.length > 20 ||
      recurrence.some((line) => line.length > 2000)
    ) {
      return { issue: unavailable, times: [] };
    }
    const duration =
      time.kind === "timed"
        ? Temporal.Instant.from(time.end).epochNanoseconds -
          Temporal.Instant.from(time.start).epochNanoseconds
        : Temporal.PlainDate.from(time.startDate).until(time.endDate).days;
    const occurrences = new Map<string, CalendarEventTime>();
    const exclusions = new Set<string>();
    const toOccurrence = (
      value: ICAL.Time,
      zone: string
    ): CalendarEventTime | null => {
      if (time.kind === "all-day") {
        if (!value.isDate || typeof duration !== "number") {
          throw new TypeError(unavailable);
        }
        const date = Temporal.PlainDate.from(value.toString());
        return {
          endDate: date.add({ days: duration }).toString(),
          kind: "all-day",
          startDate: date.toString(),
        };
      }
      if (value.isDate || typeof duration !== "bigint") {
        throw new TypeError(unavailable);
      }
      let instant: Temporal.Instant;
      if (value.zone === ICAL.Timezone.utcTimezone) {
        instant = Temporal.Instant.from(value.toString());
      } else {
        const wall = Temporal.PlainDateTime.from(value.toString());
        const zoned = wall.toZonedDateTime(zone, {
          disambiguation: "compatible",
        });
        // Nonexistent local times are omitted; ambiguous times use the first occurrence.
        if (!zoned.toPlainDateTime().equals(wall)) {
          return null;
        }
        instant = zoned.toInstant();
      }
      return {
        ...time,
        end: Temporal.Instant.fromEpochNanoseconds(
          instant.epochNanoseconds + duration
        ).toString(),
        start: instant.toString(),
      };
    };
    const include = (occurrence: CalendarEventTime) => {
      if (occurrence.kind === "all-day") {
        if (
          occurrence.startDate < endDate.toString() &&
          occurrence.endDate > firstDate.toString()
        ) {
          occurrences.set(occurrence.startDate, occurrence);
        }
      } else if (
        Temporal.Instant.compare(occurrence.start, rangeEnd) < 0 &&
        Temporal.Instant.compare(occurrence.end, rangeStart) > 0
      ) {
        occurrences.set(occurrence.start, occurrence);
      }
    };
    include(time);
    let scanned = 0;
    for (const line of recurrence) {
      const property = ICAL.Property.fromString(line);
      if (property.name === "rrule") {
        const rule: unknown = property.getFirstValue();
        // Unknown RRULE parts are otherwise silently discarded by the library parser.
        if (
          !(rule instanceof ICAL.Recur) ||
          !canPreviewRule(rule) ||
          line
            .slice(line.indexOf(":") + 1)
            .split(";")
            .some(
              (part) =>
                !/^(?:FREQ|INTERVAL|COUNT|UNTIL|WKST|BYDAY|BYMONTHDAY|BYMONTH)=/u.test(
                  part
                )
            )
        ) {
          return { issue: unavailable, times: [] };
        }
        const yearlyMonth = Number(
          rule.getComponent("BYMONTH")[0] ?? initial.month
        );
        const yearlyDay = Number(
          rule.getComponent("BYMONTHDAY")[0] ?? initial.day
        );
        if (
          rule.freq === "YEARLY" &&
          (yearlyMonth < 1 ||
            yearlyMonth > 12 ||
            yearlyDay === 0 ||
            Math.abs(yearlyDay) >
              Temporal.PlainDate.from({
                day: 1,
                month: yearlyMonth,
                year: 2000,
              }).daysInMonth)
        ) {
          return { issue: unavailable, times: [] };
        }
        const until = rule.until?.clone();
        const { count } = rule;
        rule.count = null;
        rule.until = limit;
        const iterator = rule.iterator(initial);
        let accepted = 0;
        while (scanned < 2000) {
          scanned += 1;
          const next = iterator.next();
          if (next === null || next.compare(limit) >= 0) {
            break;
          }
          if (rule.freq === "YEARLY") {
            const monthDays = ICAL.Time.daysInMonth(yearlyMonth, next.year);
            const expectedDay =
              yearlyDay > 0 ? yearlyDay : monthDays + yearlyDay + 1;
            // ICAL normalizes impossible yearly dates into the following month.
            if (next.month !== yearlyMonth || next.day !== expectedDay) {
              continue;
            }
          }
          const occurrence = toOccurrence(next, eventZone);
          if (!occurrence) {
            continue;
          }
          if (until) {
            const end = toOccurrence(until, eventZone);
            if (
              !end ||
              (occurrence.kind === "all-day" && end.kind === "all-day"
                ? occurrence.startDate > end.startDate
                : occurrence.kind === "timed" &&
                  end.kind === "timed" &&
                  Temporal.Instant.compare(occurrence.start, end.start) > 0)
            ) {
              break;
            }
          }
          accepted += 1;
          include(occurrence);
          if (count !== null && accepted >= count) {
            break;
          }
        }
        if (scanned >= 2000) {
          return {
            issue:
              "There are too many repeats to preview in this range. The event will still use the configured repeat rule when saved.",
            times: [],
          };
        }
      } else if (property.name === "rdate" || property.name === "exdate") {
        const zone: unknown = property.getParameter("tzid");
        for (const value of property.getValues()) {
          if (!(value instanceof ICAL.Time)) {
            return { issue: unavailable, times: [] };
          }
          const occurrence = toOccurrence(
            value,
            typeof zone === "string" ? zone : eventZone
          );
          if (occurrence) {
            if (property.name === "exdate") {
              exclusions.add(
                occurrence.kind === "all-day"
                  ? occurrence.startDate
                  : occurrence.start
              );
            } else {
              include(occurrence);
            }
          }
        }
      } else {
        return { issue: unavailable, times: [] };
      }
    }
    return {
      times: [...occurrences]
        .filter(([key]) => !exclusions.has(key))
        .map(([, occurrence]) => occurrence),
    };
  } catch {
    return { issue: unavailable, times: [] };
  }
};
