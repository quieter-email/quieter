import { Temporal } from "@js-temporal/polyfill";

import type { CalendarEventTime, CalendarView } from "./contracts";

export const getCalendarDates = ({
  date,
  view,
  weekStartsOn = 1,
}: {
  date: string;
  view: CalendarView;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}): string[] => {
  const selected = Temporal.PlainDate.from(date);
  let start = selected;
  let count = 1;

  switch (view) {
    case "week": {
      start = selected.subtract({
        days: (selected.dayOfWeek - weekStartsOn + 7) % 7,
      });
      count = 7;
      break;
    }
    case "month": {
      const first = selected.with({ day: 1 });
      start = first.subtract({
        days: (first.dayOfWeek - weekStartsOn + 7) % 7,
      });
      count = 42;
      break;
    }
    case "agenda": {
      count = 30;
      break;
    }
    case "day": {
      break;
    }
    default: {
      const exhaustive: never = view;
      throw new Error("Unknown calendar view.", { cause: exhaustive });
    }
  }

  return Array.from({ length: count }, (_, offset) =>
    start.add({ days: offset }).toString()
  );
};

export const getCalendarRange = ({
  date,
  timeZone,
  view,
  weekStartsOn,
}: {
  date: string;
  timeZone: string;
  view: CalendarView;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}): { dates: string[]; end: string; start: string } => {
  const dates = getCalendarDates({ date, view, weekStartsOn });
  const start = Temporal.PlainDate.from(dates[0] ?? date);
  const end = start.add({ days: dates.length });

  return {
    dates,
    end: end.toZonedDateTime(timeZone).toInstant().toString(),
    start: start.toZonedDateTime(timeZone).toInstant().toString(),
  };
};

export const getZonedDateTimeFields = ({
  instant,
  timeZone,
}: {
  instant: string;
  timeZone: string;
}): { date: string; time: string } => {
  const local = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return {
    date: local.toPlainDate().toString(),
    time: local.toPlainTime().toString({ smallestUnit: "minute" }),
  };
};

export const calendarWallTimeToInstant = ({
  date,
  disambiguation = "reject",
  time,
  timeZone,
}: {
  date: string;
  disambiguation?: "reject" | "earlier" | "later" | "compatible";
  time: string;
  timeZone: string;
}): string =>
  Temporal.PlainDate.from(date)
    .toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(timeZone, { disambiguation })
    .toInstant()
    .toString();

export const createCalendarEventTimeSplitter = ({
  dates,
  timeZone,
}: {
  dates: string[];
  timeZone: string;
}) => {
  const days = dates.map((date) => {
    const day = Temporal.PlainDate.from(date);
    return {
      date,
      end: day.add({ days: 1 }).toZonedDateTime(timeZone).epochNanoseconds,
      start: day.toZonedDateTime(timeZone).epochNanoseconds,
    };
  });

  return (
    time: CalendarEventTime
  ): {
    allDay: boolean;
    date: string;
    endMinute: number;
    startMinute: number;
  }[] => {
    if (time.kind === "all-day") {
      return days
        .filter(({ date }) => date >= time.startDate && date < time.endDate)
        .map(({ date }) => ({
          allDay: true,
          date,
          endMinute: 1440,
          startMinute: 0,
        }));
    }

    const eventStart = Temporal.Instant.from(time.start);
    const eventEnd = Temporal.Instant.from(time.end);
    const start = eventStart.epochNanoseconds;
    const end = eventEnd.epochNanoseconds;
    const occupiedDays = days.filter(
      (day) => start < day.end && end > day.start
    );
    if (occupiedDays.length === 0) {
      return [];
    }
    const localStart = eventStart.toZonedDateTimeISO(timeZone).toPlainTime();
    const localEnd = eventEnd.toZonedDateTimeISO(timeZone).toPlainTime();
    return occupiedDays.map((day) => ({
      allDay: false,
      date: day.date,
      endMinute:
        end >= day.end
          ? 1440
          : localEnd.hour * 60 + localEnd.minute + localEnd.second / 60,
      startMinute:
        start < day.start
          ? 0
          : localStart.hour * 60 + localStart.minute + localStart.second / 60,
    }));
  };
};

export const moveCalendarEventTime = ({
  date,
  minute,
  source,
  time,
  timeZone,
}: {
  date: string;
  minute: number;
  source?: { date: string; minute: number };
  time: CalendarEventTime;
  timeZone: string;
}): CalendarEventTime => {
  const targetDate = Temporal.PlainDate.from(date);
  const dayShift = source
    ? Temporal.PlainDate.from(source.date).until(targetDate, {
        largestUnit: "day",
      }).days
    : 0;
  if (time.kind === "all-day") {
    const duration = Temporal.PlainDate.from(time.startDate).until(
      Temporal.PlainDate.from(time.endDate),
      { largestUnit: "day" }
    );
    const start = source
      ? Temporal.PlainDate.from(time.startDate).add({ days: dayShift })
      : targetDate;
    return {
      endDate: start.add(duration).toString(),
      kind: "all-day",
      startDate: start.toString(),
    };
  }

  if (!Number.isInteger(minute) || minute < 0 || minute >= 1440) {
    throw new RangeError("Choose a time within the day.");
  }
  const targetTime = Temporal.PlainTime.from({
    hour: Math.floor(minute / 60),
    minute: minute % 60,
  });
  const target = source
    ? Temporal.Instant.from(time.start)
        .toZonedDateTimeISO(timeZone)
        .toPlainDateTime()
        .add({ days: dayShift, minutes: minute - source.minute })
    : targetDate.toPlainDateTime(targetTime);
  const start = target
    .toZonedDateTime(timeZone, { disambiguation: "reject" })
    .toInstant();
  const duration =
    Temporal.Instant.from(time.end).epochNanoseconds -
    Temporal.Instant.from(time.start).epochNanoseconds;
  return {
    ...time,
    end: Temporal.Instant.fromEpochNanoseconds(
      start.epochNanoseconds + duration
    ).toString(),
    start: start.toString(),
  };
};
