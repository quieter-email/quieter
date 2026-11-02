import {
  calendarDateSchema,
  calendarEventPatchSchema,
} from "@quieter/calendar";
import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";

export const recurrenceWeekdays = [
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
] as const;
export type RecurrenceWeekday = (typeof recurrenceWeekdays)[number];
export type RecurrenceContext = {
  startDate: string;
  timeZone: string;
  allDay: boolean;
};
export type RecurrenceDraft = {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: string;
  weekdays: RecurrenceWeekday[];
  monthly: "date" | "weekday";
  monthDay: string;
  ordinal: string;
  weekday: RecurrenceWeekday;
  ending: "never" | "date" | "count";
  endDate: string;
  count: string;
};

export const createRecurrenceDraft = (startDate: string): RecurrenceDraft => {
  const date = new Date(`${startDate}T12:00:00Z`);
  const weekday = recurrenceWeekdays[(date.getUTCDay() + 6) % 7] ?? "MO";
  return {
    count: "10",
    endDate: startDate,
    ending: "never",
    frequency: "WEEKLY",
    interval: "1",
    monthDay: String(date.getUTCDate()),
    monthly: "date",
    ordinal: String(Math.ceil(date.getUTCDate() / 7)),
    weekday,
    weekdays: [weekday],
  };
};

const recurrenceUntil = (date: string, context: RecurrenceContext): string => {
  calendarDateSchema.parse(date);
  if (context.allDay) {
    return date.replaceAll("-", "");
  }
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const midnight = calendarWallTimeToInstant({
    date: next.toISOString().slice(0, 10),
    disambiguation: "compatible",
    time: "00:00",
    timeZone: context.timeZone,
  });
  return new Date(new Date(midnight).getTime() - 1000)
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(".000", "");
};

export const buildRecurrence = (
  draft: RecurrenceDraft,
  context: RecurrenceContext
): string[] => {
  if (
    !/^[1-9]\d*$/u.test(draft.interval) ||
    Number(draft.interval) > 2_147_483_647
  ) {
    throw new Error("Enter a positive whole number for the repeat interval.");
  }
  const parts = [`FREQ=${draft.frequency}`, `INTERVAL=${draft.interval}`];
  if (draft.frequency === "WEEKLY") {
    if (!draft.weekdays.length) {
      throw new Error("Choose at least one weekday.");
    }
    parts.push(
      `BYDAY=${recurrenceWeekdays.filter((day) => draft.weekdays.includes(day)).join(",")}`
    );
  }
  if (draft.frequency === "MONTHLY") {
    if (draft.monthly === "date") {
      if (!/^(?:[1-9]|[12]\d|3[01])$/u.test(draft.monthDay)) {
        throw new Error("Choose a day between 1 and 31.");
      }
      parts.push(`BYMONTHDAY=${draft.monthDay}`);
    } else {
      if (!/^(?:[1-5]|-1)$/u.test(draft.ordinal)) {
        throw new Error("Choose a valid week of the month.");
      }
      parts.push(`BYDAY=${draft.ordinal}${draft.weekday}`);
    }
  }
  if (draft.frequency === "YEARLY") {
    calendarDateSchema.parse(context.startDate);
    parts.push(
      `BYMONTH=${Number(context.startDate.slice(5, 7))}`,
      `BYMONTHDAY=${Number(context.startDate.slice(8, 10))}`
    );
  }
  if (draft.ending === "count") {
    if (
      !/^[1-9]\d*$/u.test(draft.count) ||
      Number(draft.count) > 2_147_483_647
    ) {
      throw new Error("Enter a positive whole number of occurrences.");
    }
    parts.push(`COUNT=${draft.count}`);
  }
  if (draft.ending === "date") {
    if (
      !calendarDateSchema.safeParse(draft.endDate).success ||
      draft.endDate < context.startDate
    ) {
      throw new Error("Choose an end date on or after the event starts.");
    }
    parts.push(`UNTIL=${recurrenceUntil(draft.endDate, context)}`);
  }
  return [`RRULE:${parts.join(";")}`];
};

export const readRecurrence = (
  value: string[],
  context: RecurrenceContext
): RecurrenceDraft | null => {
  if (value.length === 0) {
    return createRecurrenceDraft(context.startDate);
  }
  const [rule] = value;
  if (value.length !== 1 || !rule?.startsWith("RRULE:")) {
    return null;
  }
  const entries = rule
    .slice(6)
    .split(";")
    .map((part) => part.split("="));
  if (
    entries.some((entry) => entry.length !== 2 || !entry[0] || !entry[1]) ||
    new Set(entries.map(([key]) => key)).size !== entries.length
  ) {
    return null;
  }
  const parts = Object.fromEntries<string>(
    entries.map(([key, part]) => [key ?? "", part ?? ""])
  );
  if (
    Object.keys(parts).some(
      (key) =>
        ![
          "FREQ",
          "INTERVAL",
          "BYDAY",
          "BYMONTHDAY",
          "BYMONTH",
          "COUNT",
          "UNTIL",
        ].includes(key)
    )
  ) {
    return null;
  }
  const frequency = parts.FREQ;
  if (
    frequency !== "DAILY" &&
    frequency !== "WEEKLY" &&
    frequency !== "MONTHLY" &&
    frequency !== "YEARLY"
  ) {
    return null;
  }
  const draft: RecurrenceDraft = {
    ...createRecurrenceDraft(context.startDate),
    frequency,
    interval: parts.INTERVAL ?? "1",
  };
  if (parts.COUNT && parts.UNTIL) {
    return null;
  }
  if (parts.COUNT) {
    draft.ending = "count";
    draft.count = parts.COUNT;
  }
  if (parts.UNTIL) {
    try {
      const until = parts.UNTIL;
      const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
      draft.endDate = context.allDay
        ? date
        : getZonedDateTimeFields({
            instant: `${date}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`,
            timeZone: context.timeZone,
          }).date;
      if (recurrenceUntil(draft.endDate, context) !== until) {
        return null;
      }
      draft.ending = "date";
    } catch {
      return null;
    }
  }
  if (frequency === "WEEKLY" && parts.BYDAY) {
    const days = parts.BYDAY.split(",");
    if (
      !days.every((day): day is RecurrenceWeekday =>
        recurrenceWeekdays.some((known) => known === day)
      )
    ) {
      return null;
    }
    draft.weekdays = days;
  } else if (frequency === "MONTHLY" && parts.BYDAY) {
    const match =
      /^(?<ordinal>[1-5]|-1)(?<weekday>MO|TU|WE|TH|FR|SA|SU)$/u.exec(
        parts.BYDAY
      );
    const weekday = recurrenceWeekdays.find(
      (day) => day === match?.groups?.weekday
    );
    if (!match?.groups?.ordinal || !weekday || parts.BYMONTHDAY) {
      return null;
    }
    draft.monthly = "weekday";
    draft.ordinal = match.groups.ordinal;
    draft.weekday = weekday;
  } else if (parts.BYDAY) {
    return null;
  }
  if (parts.BYMONTHDAY) {
    if (frequency === "YEARLY" && !parts.BYMONTH) {
      return null;
    }
    if (frequency !== "MONTHLY" && frequency !== "YEARLY") {
      return null;
    }
    if (
      frequency === "YEARLY" &&
      Number(parts.BYMONTHDAY) !== Number(context.startDate.slice(8, 10))
    ) {
      return null;
    }
    draft.monthDay = parts.BYMONTHDAY;
  }
  if (
    parts.BYMONTH &&
    (frequency !== "YEARLY" ||
      Number(parts.BYMONTH) !== Number(context.startDate.slice(5, 7)))
  ) {
    return null;
  }
  try {
    buildRecurrence(draft, context);
    return draft;
  } catch {
    return null;
  }
};

const validateRecurrenceDate = (stamp: string, allDay: boolean) => {
  if (!(allDay ? /^\d{8}$/u : /^\d{8}T\d{6}Z?$/u).test(stamp)) {
    throw new Error(
      allDay
        ? "Use YYYYMMDD for recurrence dates."
        : "Use YYYYMMDDTHHMMSS, with Z for UTC, for recurrence times."
    );
  }
  const date = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  if (
    !calendarDateSchema.safeParse(date).success ||
    (!allDay &&
      (Number(stamp.slice(9, 11)) > 23 ||
        Number(stamp.slice(11, 13)) > 59 ||
        Number(stamp.slice(13, 15)) > 60))
  ) {
    throw new Error("Enter valid recurrence dates and times.");
  }
};

export const parseAdvancedRecurrence = (
  text: string,
  context: RecurrenceContext
): string[] => {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error("Enter a repeat rule, or choose Does not repeat.");
  }
  if (!calendarEventPatchSchema.safeParse({ recurrence: lines }).success) {
    throw new Error(
      "Use up to 20 RRULE, RDATE, EXDATE or EXRULE lines, with at most 2,000 characters each."
    );
  }
  for (const line of lines) {
    if (/^(?:RDATE|EXDATE)(?:;|:)/u.test(line)) {
      const colon = line.indexOf(":");
      const header = new Set(line.slice(0, colon).split(";"));
      const period = header.has("VALUE=PERIOD");
      if (period && line.startsWith("EXDATE")) {
        throw new Error("Excluded dates cannot use periods.");
      }
      for (const stamp of line.slice(colon + 1).split(",")) {
        if (period) {
          const [start, end, extra] = stamp.split("/");
          if (!start || !end || extra !== undefined) {
            throw new Error(
              "A repeat period needs a start and an end or duration."
            );
          }
          validateRecurrenceDate(start, false);
          if (
            !/^P(?=\d|T\d)(?:\d+W|(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?)$/u.test(
              end
            )
          ) {
            validateRecurrenceDate(end, false);
          }
        } else {
          validateRecurrenceDate(
            stamp,
            header.has("VALUE=DATE") && !header.has("VALUE=DATE-TIME")
          );
        }
      }
      continue;
    }
    if (!/^(?:RRULE|EXRULE):/u.test(line)) {
      throw new Error("Repeat rules use RRULE: or EXRULE: without parameters.");
    }
    const entries = line
      .slice(line.indexOf(":") + 1)
      .split(";")
      .map((part) => part.split("="));
    if (
      entries.some(([key, value]) => !key || !value) ||
      entries.some((part) => part.length !== 2) ||
      new Set(entries.map(([key]) => key)).size !== entries.length
    ) {
      throw new Error(
        "Each rule needs unique NAME=value parts separated by semicolons."
      );
    }
    const parts = Object.fromEntries<string>(
      entries.map(([key, part]) => [key ?? "", part ?? ""])
    );
    if (
      !/^(?:SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)$/u.test(
        parts.FREQ ?? ""
      )
    ) {
      throw new Error("Each repeat rule needs a valid FREQ.");
    }
    if (parts.COUNT && parts.UNTIL) {
      throw new Error("Use either COUNT or UNTIL, not both.");
    }
    for (const key of ["COUNT", "INTERVAL"]) {
      if (
        parts[key] !== undefined &&
        (!/^[1-9]\d*$/u.test(parts[key]) || Number(parts[key]) > 2_147_483_647)
      ) {
        throw new Error(`${key} must be a positive whole number.`);
      }
    }
    if (parts.UNTIL) {
      if (
        !(context.allDay ? /^\d{8}$/u : /^\d{8}T\d{6}Z$/u).test(parts.UNTIL)
      ) {
        throw new Error(
          context.allDay
            ? "Use YYYYMMDD for an all-day end date."
            : "Use YYYYMMDDTHHMMSSZ for a timed end date in UTC."
        );
      }
      const until = parts.UNTIL;
      const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
      validateRecurrenceDate(until, context.allDay);
      const localDate = context.allDay
        ? date
        : getZonedDateTimeFields({
            instant: `${date}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`,
            timeZone: context.timeZone,
          }).date;
      if (localDate < context.startDate) {
        throw new Error(
          "The repeat end date cannot be before the event starts."
        );
      }
    }
    if (
      parts.BYDAY &&
      !parts.BYDAY.split(",").every((day) =>
        /^(?:[+-]?[1-9]\d?)?(?:MO|TU|WE|TH|FR|SA|SU)$/u.test(day)
      )
    ) {
      throw new Error("BYDAY must contain weekdays such as MO,WE or 2FR.");
    }
    if (
      parts.BYDAY?.split(",").some(
        (day) =>
          /^[-+]?\d/u.test(day) &&
          (Math.abs(Number(day.slice(0, -2))) > 53 ||
            (parts.FREQ !== "MONTHLY" && parts.FREQ !== "YEARLY") ||
            (parts.FREQ === "YEARLY" && parts.BYWEEKNO !== undefined))
      )
    ) {
      throw new Error(
        "Numbered weekdays require a monthly or yearly rule without week numbers."
      );
    }
    if (parts.BYMONTHDAY && parts.FREQ === "WEEKLY") {
      throw new Error("Weekly rules use BYDAY rather than BYMONTHDAY.");
    }
    if (parts.BYWEEKNO && parts.FREQ !== "YEARLY") {
      throw new Error("Week numbers require a yearly rule.");
    }
    if (
      parts.BYYEARDAY &&
      ["DAILY", "WEEKLY", "MONTHLY"].includes(parts.FREQ ?? "")
    ) {
      throw new Error(
        "Day-of-year rules cannot repeat daily, weekly or monthly."
      );
    }
    if (
      parts.BYSETPOS &&
      !Object.keys(parts).some(
        (key) => key.startsWith("BY") && key !== "BYSETPOS"
      )
    ) {
      throw new Error("BYSETPOS needs another BY rule to select from.");
    }
    if (parts.WKST && !recurrenceWeekdays.some((day) => day === parts.WKST)) {
      throw new Error("WKST must be a weekday such as MO.");
    }
    const ranges: [string, number, number, boolean][] = [
      ["BYMONTH", 1, 12, false],
      ["BYMONTHDAY", -31, 31, true],
      ["BYSETPOS", -366, 366, true],
      ["BYYEARDAY", -366, 366, true],
      ["BYWEEKNO", -53, 53, true],
      ["BYHOUR", 0, 23, false],
      ["BYMINUTE", 0, 59, false],
      ["BYSECOND", 0, 60, false],
    ];
    for (const [key, min, max, excludeZero] of ranges) {
      if (
        parts[key]
          ?.split(",")
          .some(
            (value) =>
              !/^[+-]?\d+$/u.test(value) ||
              Number(value) < min ||
              Number(value) > max ||
              (excludeZero && Number(value) === 0)
          )
      ) {
        throw new Error(`${key} contains an invalid number.`);
      }
    }
  }
  return lines;
};
