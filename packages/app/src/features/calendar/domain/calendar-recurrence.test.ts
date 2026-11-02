import { describe, expect, it } from "vite-plus/test";

import {
  buildRecurrence,
  createRecurrenceDraft,
  parseAdvancedRecurrence,
  readRecurrence,
} from "./calendar-recurrence";

const context = {
  allDay: false,
  startDate: "2026-03-01",
  timeZone: "America/New_York",
};

describe("calendar recurrence", () => {
  it("includes the entire selected local date across daylight-saving changes", () => {
    const draft = {
      ...createRecurrenceDraft(context.startDate),
      endDate: "2026-03-08",
      ending: "date" as const,
    };
    const rules = buildRecurrence(draft, context);
    expect(rules[0]).toContain("UNTIL=20260309T035959Z");
    expect(readRecurrence(rules, context)).toMatchObject({
      endDate: "2026-03-08",
      ending: "date",
    });
    const autumn = buildRecurrence(
      { ...draft, endDate: "2026-11-01" },
      context
    );
    expect(autumn[0]).toContain("UNTIL=20261102T045959Z");
  });

  it("keeps all-day end dates as dates and preserves counted ordinal schedules", () => {
    const rules = buildRecurrence(
      {
        ...createRecurrenceDraft(context.startDate),
        endDate: "2026-03-08",
        ending: "date",
      },
      { ...context, allDay: true }
    );
    expect(rules[0]).toContain("UNTIL=20260308");
    const monthly = buildRecurrence(
      {
        ...createRecurrenceDraft(context.startDate),
        count: "6",
        ending: "count",
        frequency: "MONTHLY",
        interval: "2",
        monthly: "weekday",
        ordinal: "-1",
        weekday: "FR",
      },
      context
    );
    expect(readRecurrence(monthly, context)).toMatchObject({
      count: "6",
      ending: "count",
      frequency: "MONTHLY",
      interval: "2",
      monthly: "weekday",
      ordinal: "-1",
      weekday: "FR",
    });
  });

  it("preserves advanced options and exclusions without silently simplifying them", () => {
    const rules = [
      "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;WKST=SU",
      "EXDATE;TZID=America/New_York:20260331T090000",
      "RDATE;TZID=America/New_York:20260401T090000",
    ];
    expect(readRecurrence(rules, context)).toBeNull();
    expect(parseAdvancedRecurrence(rules.join("\n"), context)).toStrictEqual(
      rules
    );
    expect(
      readRecurrence(["RRULE:FREQ=WEEKLY;UNTIL=20260308T140000Z"], context)
    ).toBeNull();
    expect(
      readRecurrence(["RRULE:FREQ=DAILY;X-EXTENSION=KEEP"], context)
    ).toBeNull();
    expect(
      parseAdvancedRecurrence("RRULE:FREQ=DAILY;X-EXTENSION=KEEP", context)
    ).toContain("RRULE:FREQ=DAILY;X-EXTENSION=KEEP");
  });

  it("accepts date exclusions and periods while rejecting excluded periods", () => {
    const allDayRules = "RRULE:FREQ=DAILY\nEXDATE;VALUE=DATE:20260303";
    expect(
      parseAdvancedRecurrence(allDayRules, { ...context, allDay: true })
    ).toContain("EXDATE;VALUE=DATE:20260303");
    expect(
      parseAdvancedRecurrence(
        "RDATE;VALUE=PERIOD:20260303T090000Z/PT2H",
        context
      )
    ).toHaveLength(1);
    expect(() =>
      parseAdvancedRecurrence(
        "EXDATE;VALUE=PERIOD:20260303T090000Z/PT2H",
        context
      )
    ).toThrow(/period/u);
  });

  it("rejects contradictory and malformed rules before applying", () => {
    for (const rule of [
      "RRULE:FREQ=WEEKLY;COUNT=3;UNTIL=20260308T140000Z",
      "RRULE:FREQ=DAILY;INTERVAL=0",
      "RRULE:FREQ=DAILY;FREQ=WEEKLY",
      "RRULE:FREQ=WEEKLY;BYDAY=XX",
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=0",
      "RRULE:FREQ=DAILY;UNTIL=20260230T120000Z",
    ]) {
      expect(() => parseAdvancedRecurrence(rule, context)).toThrow(/.+/u);
    }
    expect(() =>
      buildRecurrence(
        { ...createRecurrenceDraft(context.startDate), weekdays: [] },
        context
      )
    ).toThrow(/.+/u);
    expect(() =>
      buildRecurrence(
        {
          ...createRecurrenceDraft(context.startDate),
          endDate: "2026-02-28",
          ending: "date",
        },
        context
      )
    ).toThrow(/.+/u);
  });
});
