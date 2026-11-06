import type { CalendarEventTime } from "@quieter/calendar";
import { getCalendarRecurrencePreview } from "@quieter/calendar/recurrence";
import { describe, expect, test } from "vite-plus/test";

import {
  fromMicrosoftRecurrence,
  toMicrosoftRecurrence,
} from "../src/calendar/microsoft-recurrence";

const monthEnd: CalendarEventTime = {
  endDate: "2026-02-01",
  kind: "all-day",
  startDate: "2026-01-31",
};

describe("Microsoft recurrence date semantics", () => {
  test.each([
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=29;COUNT=3",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=30;COUNT=3",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3",
    "RRULE:FREQ=MONTHLY;COUNT=3",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;UNTIL=20261231",
    "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=3",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31",
  ])("rejects a rule that could replace skipped dates: %s", (rule) => {
    expect(() => toMicrosoftRecurrence([rule], monthEnd)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  test("checks the local starting day when the rule omits it", () => {
    expect(() =>
      toMicrosoftRecurrence(["RRULE:FREQ=MONTHLY"], {
        end: "2026-01-29T00:30:00Z",
        kind: "timed",
        start: "2026-01-28T23:30:00Z",
        timeZone: "Europe/Berlin",
      })
    ).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  test.each([
    {
      rule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=28;COUNT=3",
      type: "absoluteMonthly",
    },
    { rule: "RRULE:FREQ=YEARLY;COUNT=3", type: "absoluteYearly" },
    {
      rule: "RRULE:FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=30",
      type: "absoluteYearly",
    },
    { rule: "RRULE:FREQ=MONTHLY;BYDAY=-1SA;COUNT=3", type: "relativeMonthly" },
  ])("preserves a representable pattern: $rule", ({ rule, type }) => {
    expect(toMicrosoftRecurrence([rule], monthEnd)).toMatchObject({
      pattern: { type },
    });
  });

  test.each([29, 30, 31])(
    "does not preview skipped dates for an existing monthly series on day %s",
    (dayOfMonth) => {
      const recurrence = fromMicrosoftRecurrence(
        {
          pattern: { dayOfMonth, interval: 1, type: "absoluteMonthly" },
          range: {
            numberOfOccurrences: 3,
            startDate: "2026-01-31",
            type: "numbered",
          },
        },
        monthEnd
      );
      const result = getCalendarRecurrencePreview({
        dates: ["2026-01-01", "2026-12-31"],
        recurrence,
        time: monthEnd,
        timeZone: "UTC",
      });
      expect(result.issue).toBeTruthy();
      expect(result.times).toHaveLength(0);
    }
  );

  test("keeps a valid yearly month-end preview available", () => {
    const recurrence = fromMicrosoftRecurrence(
      {
        pattern: {
          dayOfMonth: 31,
          interval: 1,
          month: 1,
          type: "absoluteYearly",
        },
        range: {
          numberOfOccurrences: 3,
          startDate: "2026-01-31",
          type: "numbered",
        },
      },
      monthEnd
    );
    const result = getCalendarRecurrencePreview({
      dates: ["2026-01-01", "2028-12-31"],
      recurrence,
      time: monthEnd,
      timeZone: "UTC",
    });
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([
      { startDate: "2026-01-31" },
      { startDate: "2027-01-31" },
      { startDate: "2028-01-31" },
    ]);
  });

  test("does not preview skipped leap years for an existing February series", () => {
    const time: CalendarEventTime = {
      endDate: "2028-03-01",
      kind: "all-day",
      startDate: "2028-02-29",
    };
    const recurrence = fromMicrosoftRecurrence(
      {
        pattern: {
          dayOfMonth: 29,
          interval: 1,
          month: 2,
          type: "absoluteYearly",
        },
        range: {
          numberOfOccurrences: 3,
          startDate: "2028-02-29",
          type: "numbered",
        },
      },
      time
    );
    const result = getCalendarRecurrencePreview({
      dates: ["2028-01-01", "2036-12-31"],
      recurrence,
      time,
      timeZone: "UTC",
    });
    expect(result.issue).toBeTruthy();
    expect(result.times).toHaveLength(0);
  });
});
