import { describe, expect, it } from "vite-plus/test";

import type { CalendarEventTime } from "./contracts";
import { getCalendarRecurrencePreview } from "./recurrence";

const time: CalendarEventTime = {
  end: "2026-03-27T10:00:00Z",
  kind: "timed",
  start: "2026-03-27T09:00:00Z",
  timeZone: "Europe/Berlin",
};
const dates = [
  "2026-03-27",
  "2026-03-28",
  "2026-03-29",
  "2026-03-30",
  "2026-03-31",
];
const preview = (
  recurrence: string[],
  changes: Partial<Parameters<typeof getCalendarRecurrencePreview>[0]> = {}
) =>
  getCalendarRecurrencePreview({
    dates,
    recurrence,
    time,
    timeZone: "Europe/Berlin",
    ...changes,
  });

describe("recurring calendar previews", () => {
  it("preserves wall time across spring daylight saving and stops at the count", () => {
    const result = preview(["RRULE:FREQ=DAILY;COUNT=4"]);
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([
      { start: "2026-03-27T09:00:00Z" },
      { start: "2026-03-28T09:00:00Z" },
      { start: "2026-03-29T08:00:00Z" },
      { start: "2026-03-30T08:00:00Z" },
    ]);
  });

  it("honors an inclusive UTC end across an offset change", () => {
    expect(
      preview(["RRULE:FREQ=DAILY;UNTIL=20260329T080000Z"]).times
    ).toHaveLength(3);
    expect(
      preview(["RRULE:FREQ=DAILY;UNTIL=20260329T075959Z"]).times
    ).toHaveLength(2);
  });

  it("deduplicates additional dates and applies timezone exclusions after combining rules", () => {
    const result = preview([
      "RRULE:FREQ=DAILY;COUNT=4",
      "RDATE:20260330T080000Z,20260331T080000Z",
      "EXDATE;TZID=Europe/Berlin:20260329T100000",
    ]);
    expect(result.issue).toBeUndefined();
    expect(result.times).toHaveLength(4);
    expect(result.times).not.toContainEqual(
      expect.objectContaining({ start: "2026-03-29T08:00:00Z" })
    );
  });

  it("includes an all-day occurrence that starts before the visible range", () => {
    const result = preview(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"], {
      dates: ["2026-03-31", "2026-04-01"],
      time: { endDate: "2026-03-26", kind: "all-day", startDate: "2026-03-23" },
    });
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([
      { endDate: "2026-04-02", startDate: "2026-03-30" },
    ]);
  });

  it.each([
    [
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3",
      ["2026-01-31", "2026-03-31", "2026-05-31"],
    ],
    [
      "RRULE:FREQ=MONTHLY;BYDAY=-1SA;COUNT=3",
      ["2026-01-31", "2026-02-28", "2026-03-28"],
    ],
    [
      "RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=31;COUNT=3",
      ["2026-01-31", "2027-01-31", "2028-01-31"],
    ],
  ])("expands calendar dates for %s", (rule, expected) => {
    const result = preview([rule], {
      dates: ["2026-01-01", "2028-12-31"],
      time: { endDate: "2026-02-01", kind: "all-day", startDate: "2026-01-31" },
    });
    expect(result.issue).toBeUndefined();
    expect(
      result.times.map((occurrence) =>
        occurrence.kind === "all-day" ? occurrence.startDate : occurrence.start
      )
    ).toMatchObject(expected);
  });

  it("skips nonexistent wall times without consuming the occurrence count", () => {
    const result = preview(["RRULE:FREQ=DAILY;COUNT=3"], {
      time: {
        ...time,
        end: "2026-03-28T02:30:00Z",
        start: "2026-03-28T01:30:00Z",
      },
    });
    expect(result.times).toMatchObject([
      { start: "2026-03-28T01:30:00Z" },
      { start: "2026-03-30T00:30:00Z" },
      { start: "2026-03-31T00:30:00Z" },
    ]);
  });

  it("keeps fall daylight saving occurrences at the same local hour", () => {
    const result = preview(["RRULE:FREQ=DAILY;COUNT=3"], {
      dates: ["2026-10-24", "2026-10-25", "2026-10-26"],
      time: {
        ...time,
        end: "2026-10-24T09:00:00Z",
        start: "2026-10-24T08:00:00Z",
      },
    });
    expect(result.times).toMatchObject([
      { start: "2026-10-24T08:00:00Z" },
      { start: "2026-10-25T09:00:00Z" },
      { start: "2026-10-26T09:00:00Z" },
    ]);
  });

  it.each([
    "RRULE:FREQ=DAILY;INTERVAL=7;BYDAY=TU",
    "RRULE:FREQ=SECONDLY",
    "RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1",
    "RRULE:FREQ=DAILY;UNKNOWN=1",
    "EXRULE:FREQ=WEEKLY;BYDAY=SA,SU",
    "RDATE;VALUE=PERIOD:20260328T100000/PT2H",
  ])(
    "reports unsupported rules without showing a misleading partial series for %s",
    (rule) => {
      const result = preview([rule]);
      expect(result.issue).toBeTruthy();
      expect(result.times).toHaveLength(0);
    }
  );

  it("applies weekly intervals and weekday sets from the original week", () => {
    const result = preview(
      ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4"],
      {
        dates: ["2026-03-01", "2026-04-30"],
        time: {
          endDate: "2026-03-03",
          kind: "all-day",
          startDate: "2026-03-02",
        },
      }
    );
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([
      { startDate: "2026-03-02" },
      { startDate: "2026-03-04" },
      { startDate: "2026-03-16" },
      { startDate: "2026-03-18" },
    ]);
  });

  it("preserves timed duration when an occurrence overlaps the visible range", () => {
    const result = preview(["RRULE:FREQ=DAILY;COUNT=2"], {
      dates: ["2026-03-29"],
      time: {
        ...time,
        end: "2026-03-28T02:00:00Z",
        start: "2026-03-27T22:00:00Z",
      },
    });
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([
      { end: "2026-03-29T02:00:00Z", start: "2026-03-28T22:00:00Z" },
    ]);
  });

  it("excludes and adds all-day dates without changing event duration", () => {
    const result = preview(
      [
        "RRULE:FREQ=DAILY;COUNT=3",
        "EXDATE;VALUE=DATE:20260328",
        "RDATE;VALUE=DATE:20260330",
      ],
      {
        time: {
          endDate: "2026-03-29",
          kind: "all-day",
          startDate: "2026-03-27",
        },
      }
    );
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([
      { endDate: "2026-03-29", startDate: "2026-03-27" },
      { endDate: "2026-03-31", startDate: "2026-03-29" },
      { endDate: "2026-04-01", startDate: "2026-03-30" },
    ]);
  });

  it("skips yearly leap-day overflow without consuming the count", () => {
    const result = preview(
      ["RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=3"],
      {
        dates: ["2024-01-01", "2033-01-01"],
        time: {
          endDate: "2024-03-01",
          kind: "all-day",
          startDate: "2024-02-29",
        },
      }
    );
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([
      { startDate: "2024-02-29" },
      { startDate: "2028-02-29" },
      { startDate: "2032-02-29" },
    ]);
  });

  it("does not turn impossible yearly dates into another month", () => {
    const result = preview(["RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30"]);
    expect(result.issue).toBeTruthy();
    expect(result.times).toHaveLength(0);
  });

  it("bounds monthly searches whose interval never reaches a matching month", () => {
    const result = preview(["RRULE:FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=30"], {
      dates: ["2026-02-01", "2028-03-01"],
      time: { endDate: "2026-02-02", kind: "all-day", startDate: "2026-02-01" },
    });
    expect(result.issue).toBeUndefined();
    expect(result.times).toMatchObject([{ startDate: "2026-02-01" }]);
  });

  it("bounds old series traversal and returns an explicit issue", () => {
    const result = preview(["RRULE:FREQ=DAILY"], {
      time: { endDate: "2000-01-02", kind: "all-day", startDate: "2000-01-01" },
    });
    expect(result.issue).toBeTruthy();
    expect(result.times).toHaveLength(0);
  });
});
