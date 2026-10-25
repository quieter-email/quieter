import { describe, expect, test } from "vite-plus/test";

import {
  calendarWallTimeToInstant,
  getCalendarDates,
  getCalendarRange,
  getZonedDateTimeFields,
  moveCalendarEventTime,
  splitCalendarEventTime,
} from "./time";

describe("calendar date ranges", () => {
  test("keeps weeks on Monday across a year boundary", () => {
    const dates = getCalendarDates({ date: "2027-01-01", view: "week" });
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-12-28");
    expect(dates.at(-1)).toBe("2027-01-03");
  });

  test("includes the whole month and adjacent days in a Monday-first six-week grid", () => {
    const dates = getCalendarDates({ date: "2026-03-12", view: "month" });
    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe("2026-02-23");
    expect(dates.at(-1)).toBe("2026-04-05");
    expect(dates).toContain("2026-03-31");
  });

  test("uses local midnight on each side of a daylight-saving transition", () => {
    const spring = getCalendarRange({
      date: "2026-03-29",
      timeZone: "Europe/Berlin",
      view: "day",
    });
    expect(spring.start).toBe("2026-03-28T23:00:00Z");
    expect(spring.end).toBe("2026-03-29T22:00:00Z");
    const autumn = getCalendarRange({
      date: "2026-10-25",
      timeZone: "Europe/Berlin",
      view: "day",
    });
    expect(autumn.start).toBe("2026-10-24T22:00:00Z");
    expect(autumn.end).toBe("2026-10-25T23:00:00Z");
  });
});

describe("calendar wall times", () => {
  test("rejects both missing and repeated local times unless explicitly disambiguated", () => {
    for (const date of ["2026-03-29", "2026-10-25"]) {
      expect(() =>
        calendarWallTimeToInstant({
          date,
          time: "02:30",
          timeZone: "Europe/Berlin",
        })
      ).toThrow(RangeError);
    }
    expect(
      calendarWallTimeToInstant({
        date: "2026-10-25",
        disambiguation: "later",
        time: "02:30",
        timeZone: "Europe/Berlin",
      })
    ).toBe("2026-10-25T01:30:00Z");
  });

  test("formats instants in the display zone including non-whole-hour offsets", () => {
    expect(
      getZonedDateTimeFields({
        instant: "2026-10-22T20:45:00Z",
        timeZone: "Asia/Kathmandu",
      })
    ).toMatchObject({ date: "2026-10-23", time: "02:30" });
  });
});

describe("calendar event segmentation", () => {
  test("clips a multi-day event and excludes a midnight end from the next date", () => {
    const segments = splitCalendarEventTime({
      dates: ["2026-10-22", "2026-10-23", "2026-10-24"],
      time: {
        end: "2026-10-23T22:00:00Z",
        kind: "timed",
        start: "2026-10-22T21:30:00Z",
        timeZone: "Europe/Berlin",
      },
      timeZone: "Europe/Berlin",
    });
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      date: "2026-10-22",
      endMinute: 1440,
      startMinute: 1410,
    });
    expect(segments[1]).toMatchObject({
      date: "2026-10-23",
      endMinute: 1440,
      startMinute: 0,
    });
  });

  test("keeps all-day dates fixed across display zones and excludes the end date", () => {
    const segments = splitCalendarEventTime({
      dates: ["2026-12-31", "2027-01-01", "2027-01-02"],
      time: { endDate: "2027-01-02", kind: "all-day", startDate: "2026-12-31" },
      timeZone: "Pacific/Honolulu",
    });
    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.date)).toContain("2026-12-31");
    expect(segments.map((segment) => segment.date)).toContain("2027-01-01");
    expect(segments.every((segment) => segment.allDay)).toBeTruthy();
  });

  test("clips at the actual midnight boundary on a short daylight-saving day", () => {
    const segments = splitCalendarEventTime({
      dates: ["2026-03-28", "2026-03-29", "2026-03-30"],
      time: {
        end: "2026-03-29T22:30:00Z",
        kind: "timed",
        start: "2026-03-28T23:30:00Z",
        timeZone: "Europe/Berlin",
      },
      timeZone: "Europe/Berlin",
    });
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      date: "2026-03-29",
      endMinute: 1440,
      startMinute: 30,
    });
    expect(segments[1]).toMatchObject({
      date: "2026-03-30",
      endMinute: 30,
      startMinute: 0,
    });
  });

  test("preserves both sides of a repeated hour without inventing a different wall time", () => {
    expect(
      splitCalendarEventTime({
        dates: ["2026-10-25"],
        time: {
          end: "2026-10-25T01:15:00Z",
          kind: "timed",
          start: "2026-10-25T00:45:00Z",
          timeZone: "Europe/Berlin",
        },
        timeZone: "Europe/Berlin",
      })[0]
    ).toMatchObject({ endMinute: 135, startMinute: 165 });
  });
});

describe("moving calendar events", () => {
  test("preserves elapsed duration when moving across a clock change", () => {
    const moved = moveCalendarEventTime({
      date: "2026-03-29",
      minute: 90,
      time: {
        end: "2026-03-28T11:00:00Z",
        kind: "timed",
        start: "2026-03-28T09:00:00Z",
        timeZone: "Europe/Berlin",
      },
      timeZone: "Europe/Berlin",
    });
    expect(moved).toMatchObject({
      end: "2026-03-29T02:30:00Z",
      start: "2026-03-29T00:30:00Z",
    });
  });

  test("refuses a drag into a missing local time", () => {
    expect(() =>
      moveCalendarEventTime({
        date: "2026-03-29",
        minute: 150,
        time: {
          end: "2026-03-28T10:00:00Z",
          kind: "timed",
          start: "2026-03-28T09:00:00Z",
          timeZone: "Europe/Berlin",
        },
        timeZone: "Europe/Berlin",
      })
    ).toThrow(RangeError);
  });

  test("preserves an all-day span across leap days and year boundaries", () => {
    expect(
      moveCalendarEventTime({
        date: "2028-02-28",
        minute: 0,
        time: {
          endDate: "2027-01-02",
          kind: "all-day",
          startDate: "2026-12-31",
        },
        timeZone: "America/Los_Angeles",
      })
    ).toMatchObject({ endDate: "2028-03-01", startDate: "2028-02-28" });
  });

  test("moves an all-day span by the dragged continuation date", () => {
    expect(
      moveCalendarEventTime({
        date: "2026-12-03",
        minute: 0,
        source: { date: "2026-12-02", minute: 0 },
        time: {
          endDate: "2026-12-04",
          kind: "all-day",
          startDate: "2026-12-01",
        },
        timeZone: "Europe/Berlin",
      })
    ).toMatchObject({ endDate: "2026-12-05", startDate: "2026-12-02" });
  });

  test("moves an overnight event from its continuation without losing the previous day", () => {
    expect(
      moveCalendarEventTime({
        date: "2026-12-04",
        minute: 30,
        source: { date: "2026-12-02", minute: 0 },
        time: {
          end: "2026-12-02T01:00:00Z",
          kind: "timed",
          start: "2026-12-01T22:00:00Z",
          timeZone: "Europe/Berlin",
        },
        timeZone: "Europe/Berlin",
      })
    ).toMatchObject({
      end: "2026-12-04T01:30:00Z",
      start: "2026-12-03T22:30:00Z",
    });
  });
});
