import { ORPCError } from "@orpc/server";
import type { CalendarEventTime } from "@quieter/calendar";
import {
  calendarInstantToWallTime,
  calendarWallTimeToInstant,
} from "@quieter/calendar/time";
import { z } from "zod";

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const indices = ["first", "second", "third", "fourth", "last"] as const;
export const microsoftRecurrenceSchema = z.object({
  pattern: z.object({
    dayOfMonth: z.number().int().optional(),
    daysOfWeek: z.array(z.enum(weekdays)).optional(),
    firstDayOfWeek: z.enum(weekdays).optional(),
    index: z.enum(indices).optional(),
    interval: z.number().int().positive(),
    month: z.number().int().optional(),
    type: z.enum([
      "daily",
      "weekly",
      "absoluteMonthly",
      "relativeMonthly",
      "absoluteYearly",
      "relativeYearly",
    ]),
  }),
  range: z.object({
    endDate: z.string().optional(),
    numberOfOccurrences: z.number().int().optional(),
    recurrenceTimeZone: z.string().optional(),
    startDate: z.iso.date(),
    type: z.enum(["endDate", "noEnd", "numbered"]),
  }),
});

const recurrenceUntil = (date: string, time: CalendarEventTime): string => {
  z.iso.date().parse(date);
  if (time.kind === "all-day") {
    return date.replaceAll("-", "");
  }
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const midnight = calendarWallTimeToInstant({
    date: next.toISOString().slice(0, 10),
    disambiguation: "compatible",
    time: "00:00",
    timeZone: time.timeZone,
  });
  return new Date(new Date(midnight).getTime() - 1000)
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(".000", "");
};

export const fromMicrosoftRecurrence = (
  recurrence: z.infer<typeof microsoftRecurrenceSchema> | null | undefined,
  time: CalendarEventTime
): string[] => {
  if (!recurrence) {
    return [];
  }
  const { pattern, range } = recurrence;
  const frequency = {
    absoluteMonthly: "MONTHLY",
    absoluteYearly: "YEARLY",
    daily: "DAILY",
    relativeMonthly: "MONTHLY",
    relativeYearly: "YEARLY",
    weekly: "WEEKLY",
  }[pattern.type];
  const parts = [`FREQ=${frequency}`, `INTERVAL=${pattern.interval}`];
  if (pattern.type === "absoluteMonthly" || pattern.type === "absoluteYearly") {
    parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
  }
  if (pattern.type === "absoluteYearly" || pattern.type === "relativeYearly") {
    parts.push(`BYMONTH=${pattern.month}`);
  }
  if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    parts.push(
      `BYDAY=${pattern.daysOfWeek.map((day) => dayCodes[weekdays.indexOf(day)]).join(",")}`
    );
  }
  if (pattern.type === "relativeMonthly" || pattern.type === "relativeYearly") {
    const index = pattern.index ?? "first";
    parts.push(
      `BYSETPOS=${index === "last" ? -1 : indices.indexOf(index) + 1}`
    );
  }
  if (pattern.firstDayOfWeek) {
    parts.push(`WKST=${dayCodes[weekdays.indexOf(pattern.firstDayOfWeek)]}`);
  }
  if (range.type === "numbered") {
    parts.push(`COUNT=${range.numberOfOccurrences}`);
  } else if (range.type === "endDate" && range.endDate) {
    parts.push(`UNTIL=${recurrenceUntil(range.endDate, time)}`);
  }
  return [`RRULE:${parts.join(";")}`];
};

export const toMicrosoftRecurrence = (
  rules: string[],
  time: CalendarEventTime
) => {
  if (rules.length === 0) {
    return null;
  }
  const invalid = new ORPCError("BAD_REQUEST", {
    message:
      "This repeat rule is not supported by this calendar. Use a daily, weekly, monthly, or yearly rule.",
  });
  if (rules.length !== 1 || !rules[0]?.startsWith("RRULE:")) {
    throw invalid;
  }
  const entries = rules[0]
    .slice(6)
    .split(";")
    .map((part) => part.split("="));
  const rule = new Map(entries.map(([key, value]) => [key, value]));
  if (
    rule.size !== entries.length ||
    entries.some(
      ([key, value, extra]) =>
        extra !== undefined ||
        !key ||
        !value ||
        ![
          "FREQ",
          "INTERVAL",
          "COUNT",
          "UNTIL",
          "WKST",
          "BYDAY",
          "BYMONTHDAY",
          "BYMONTH",
          "BYSETPOS",
        ].includes(key)
    )
  ) {
    throw invalid;
  }
  if (
    ["INTERVAL", "COUNT", "BYMONTHDAY", "BYMONTH", "BYSETPOS"].some(
      (key) => rule.has(key) && !/^-?\d+$/u.test(rule.get(key) ?? "")
    )
  ) {
    throw invalid;
  }
  const startDate =
    time.kind === "all-day"
      ? time.startDate
      : calendarInstantToWallTime(time.start, time.timeZone).slice(0, 10);
  const interval = Number(rule.get("INTERVAL") ?? 1);
  if (
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > 10_000 ||
    (rule.has("COUNT") && rule.has("UNTIL"))
  ) {
    throw invalid;
  }
  const pattern: z.infer<typeof microsoftRecurrenceSchema>["pattern"] = {
    interval,
    type: "daily",
  };
  const days = rule.get("BYDAY")?.split(",");
  const parsedDays = days?.map((day) =>
    /^(?<ordinal>-1|[1-4])?(?<day>SU|MO|TU|WE|TH|FR|SA)$/u.exec(day)
  );
  if (parsedDays?.some((day) => !day) === true) {
    throw invalid;
  }
  const frequency = rule.get("FREQ");
  if (frequency === "DAILY") {
    if (
      ["BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS"].some((part) =>
        rule.has(part)
      )
    ) {
      throw invalid;
    }
  } else if (frequency === "WEEKLY") {
    if (
      ["BYMONTHDAY", "BYMONTH", "BYSETPOS"].some((part) => rule.has(part)) ||
      parsedDays?.some((day) => Boolean(day?.groups?.ordinal)) === true
    ) {
      throw invalid;
    }
    pattern.type = "weekly";
    pattern.daysOfWeek = parsedDays
      ?.map((day) => weekdays[dayCodes.indexOf(day?.groups?.day ?? "")])
      .filter(Boolean) ?? [
      weekdays[new Date(`${startDate}T00:00:00Z`).getUTCDay()],
    ];
    const weekStart = dayCodes.indexOf(rule.get("WKST") ?? "MO");
    if (weekStart === -1) {
      throw invalid;
    }
    pattern.firstDayOfWeek = weekdays[weekStart];
  } else if (frequency === "MONTHLY" || frequency === "YEARLY") {
    if (frequency === "MONTHLY" && rule.has("BYMONTH")) {
      throw invalid;
    }
    if (parsedDays && parsedDays.length > 0) {
      if (rule.has("BYMONTHDAY")) {
        throw invalid;
      }
      const ordinal = Number(
        rule.get("BYSETPOS") ?? parsedDays[0]?.groups?.ordinal
      );
      if (
        ![-1, 1, 2, 3, 4].includes(ordinal) ||
        parsedDays.some(
          (day) =>
            Boolean(day?.groups?.ordinal) &&
            Number(day?.groups?.ordinal) !== ordinal
        ) ||
        (parsedDays.length > 1 &&
          parsedDays.some((day) => day?.groups?.ordinal))
      ) {
        throw invalid;
      }
      pattern.type =
        frequency === "MONTHLY" ? "relativeMonthly" : "relativeYearly";
      pattern.index = ordinal === -1 ? "last" : indices[ordinal - 1];
      pattern.daysOfWeek = parsedDays
        .map((day) => weekdays[dayCodes.indexOf(day?.groups?.day ?? "")])
        .filter(Boolean);
    } else {
      if (rule.has("BYSETPOS")) {
        throw invalid;
      }
      pattern.type =
        frequency === "MONTHLY" ? "absoluteMonthly" : "absoluteYearly";
      pattern.dayOfMonth = Number(rule.get("BYMONTHDAY") ?? startDate.slice(8));
      if (
        !Number.isInteger(pattern.dayOfMonth) ||
        pattern.dayOfMonth < 1 ||
        pattern.dayOfMonth > 31
      ) {
        throw invalid;
      }
    }
    if (frequency === "YEARLY") {
      pattern.month = Number(rule.get("BYMONTH") ?? startDate.slice(5, 7));
      if (
        !Number.isInteger(pattern.month) ||
        pattern.month < 1 ||
        pattern.month > 12
      ) {
        throw invalid;
      }
    }
  } else {
    throw invalid;
  }
  const range: z.infer<typeof microsoftRecurrenceSchema>["range"] = {
    recurrenceTimeZone: time.kind === "timed" ? time.timeZone : "UTC",
    startDate,
    type: "noEnd",
  };
  if (rule.has("COUNT")) {
    range.type = "numbered";
    range.numberOfOccurrences = Number(rule.get("COUNT"));
    if (
      !Number.isInteger(range.numberOfOccurrences) ||
      range.numberOfOccurrences < 1 ||
      range.numberOfOccurrences > 10_000
    ) {
      throw invalid;
    }
  } else if (rule.has("UNTIL")) {
    const until = rule.get("UNTIL") ?? "";
    if (
      !(time.kind === "all-day" ? /^\d{8}$/u : /^\d{8}T\d{6}Z$/u).test(until)
    ) {
      throw invalid;
    }
    range.type = "endDate";
    const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
    try {
      range.endDate =
        time.kind === "all-day"
          ? date
          : calendarInstantToWallTime(
              `${date}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`,
              time.timeZone
            ).slice(0, 10);
      // Preserve the shared editor's local-day cutoff without rounding.
      if (recurrenceUntil(range.endDate, time) !== until) {
        throw invalid;
      }
    } catch {
      throw invalid;
    }
    if (range.endDate < startDate) {
      throw invalid;
    }
  }
  return { pattern, range };
};
