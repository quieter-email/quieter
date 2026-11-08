import { describe, expect, test } from "vite-plus/test";

import {
  calendarWallTimeToInstant,
  createCalendarEventTimeSplitter,
  getCalendarRange,
  moveCalendarEventTime,
} from "./time";

describe("calendar date ranges", () => {
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
});

describe("calendar event segmentation", () => {
  test("clips a multi-day event and excludes a midnight end from the next date", () => {
    const splitTime = createCalendarEventTimeSplitter({
      dates: ["2026-10-22", "2026-10-23", "2026-10-24"],
      timeZone: "Europe/Berlin",
    });
    const segments = splitTime({
      end: "2026-10-23T22:00:00Z",
      kind: "timed",
      start: "2026-10-22T21:30:00Z",
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

  test("clips at the actual midnight boundary on a short daylight-saving day", () => {
    const splitTime = createCalendarEventTimeSplitter({
      dates: ["2026-03-28", "2026-03-29", "2026-03-30"],
      timeZone: "Europe/Berlin",
    });
    const segments = splitTime({
      end: "2026-03-29T22:30:00Z",
      kind: "timed",
      start: "2026-03-28T23:30:00Z",
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
    const splitTime = createCalendarEventTimeSplitter({
      dates: ["2026-10-25"],
      timeZone: "Europe/Berlin",
    });
    expect(
      splitTime({
        end: "2026-10-25T01:15:00Z",
        kind: "timed",
        start: "2026-10-25T00:45:00Z",
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
