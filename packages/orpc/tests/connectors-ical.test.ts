import { describe, expect, test } from "vite-plus/test";
import { parseIcsToGoogleCalendarEvent } from "../src/connectors/ical";

describe("ICS connector parsing", () => {
  test("parses a timed event with timezone, folded description, location, uid, and recurrence", () => {
    const event = parseIcsToGoogleCalendarEvent(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:event-1@example.com",
        "SUMMARY:Planning sync",
        "DESCRIPTION:Discuss roadmap",
        " and launch notes",
        "LOCATION:Conference Room",
        "DTSTART;TZID=Europe/Berlin:20260701T090000",
        "DTEND;TZID=Europe/Berlin:20260701T100000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );

    expect(event).toEqual({
      description: "Discuss roadmapand launch notes",
      end: { dateTime: "2026-07-01T10:00:00", timeZone: "Europe/Berlin" },
      iCalUID: "event-1@example.com",
      location: "Conference Room",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
      start: { dateTime: "2026-07-01T09:00:00", timeZone: "Europe/Berlin" },
      summary: "Planning sync",
    });
  });

  test("parses an all-day event with an implicit exclusive end date", () => {
    const event = parseIcsToGoogleCalendarEvent(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "SUMMARY:Launch day",
        "DTSTART;VALUE=DATE:20260701",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
    );

    expect(event.start).toEqual({ date: "2026-07-01" });
    expect(event.end).toEqual({ date: "2026-07-02" });
    expect(event.summary).toBe("Launch day");
  });
});
