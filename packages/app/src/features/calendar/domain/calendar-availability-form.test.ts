import type { CalendarSummary } from "@quieter/calendar";
import { describe, expect, it } from "vite-plus/test";

import {
  createCalendarAvailabilityForm,
  parseCalendarAvailabilityExpiry,
  parseCalendarAvailabilityForm,
} from "./calendar-availability-form";
import { getCalendarRefKey } from "./calendar-event-form";

const calendar: CalendarSummary = {
  access: "owner",
  calendarId: "selected-calendar",
  color: "#123456",
  connectionId: "connected-account",
  name: "Work",
  primary: false,
  selected: true,
  supportsMeetings: true,
  timeZone: "America/New_York",
};

describe("availability form conversion", () => {
  it("keeps the chosen local day across a daylight saving change and checks only selected calendars", () => {
    const result = parseCalendarAvailabilityForm({
      calendars: [calendar, { ...calendar, calendarId: "unchecked-calendar" }],
      form: {
        ...createCalendarAvailabilityForm({
          instant: "2026-03-28T12:00:00Z",
          timeZone: "Europe/Berlin",
        }),
        calendarKeys: [getCalendarRefKey(calendar)],
        endDate: "2026-03-29",
        startDate: "2026-03-29",
      },
    });
    expect(result).toMatchObject({
      kind: "valid",
      value: {
        calendars: [
          {
            calendarId: calendar.calendarId,
            connectionId: calendar.connectionId,
          },
        ],
        end: "2026-03-29T22:00:00Z",
        start: "2026-03-28T23:00:00Z",
        timeZone: "Europe/Berlin",
      },
    });
  });

  it("rejects a missing checked calendar instead of narrowing the scope", () => {
    const result = parseCalendarAvailabilityForm({
      calendars: [calendar],
      form: {
        ...createCalendarAvailabilityForm(),
        calendarKeys: [
          getCalendarRefKey(calendar),
          getCalendarRefKey({ ...calendar, calendarId: "removed-calendar" }),
        ],
      },
    });
    expect(result).toMatchObject({ kind: "invalid" });
  });
});

describe("booking expiry conversion", () => {
  it.each([
    { date: "2026-03-29", time: "02:30" },
    { date: "2026-10-25", time: "02:30" },
  ])("rejects a missing or repeated clock time on $date", ({ date, time }) => {
    const result = parseCalendarAvailabilityExpiry({
      date,
      end: "2026-11-01T00:00:00Z",
      now: "2026-03-01T00:00:00Z",
      time,
      timeZone: "Europe/Berlin",
    });
    expect(result).toMatchObject({ kind: "invalid" });
  });

  it("uses the chosen time zone and accepts the availability end boundary", () => {
    const result = parseCalendarAvailabilityExpiry({
      date: "2026-10-25",
      end: "2026-10-25T08:00:00Z",
      now: "2026-10-24T00:00:00Z",
      time: "09:00",
      timeZone: "Europe/Berlin",
    });
    expect(result).toMatchObject({
      kind: "valid",
      value: "2026-10-25T08:00:00Z",
    });
  });

  it.each([
    { end: "2026-10-25T08:00:00Z", now: "2026-10-24T00:00:00Z", time: "09:01" },
    { end: "2026-10-25T08:00:00Z", now: "2026-10-25T08:00:00Z", time: "09:00" },
  ])(
    "rejects an expiry beyond the scope or no longer in the future",
    ({ end, now, time }) => {
      const result = parseCalendarAvailabilityExpiry({
        date: "2026-10-25",
        end,
        now,
        time,
        timeZone: "Europe/Berlin",
      });
      expect(result).toMatchObject({ kind: "invalid" });
    }
  );
});
