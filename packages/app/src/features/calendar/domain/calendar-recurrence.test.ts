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
