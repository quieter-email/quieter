import { describe, expect, test } from "vite-plus/test";

import { calendarEventPatchSchema, calendarEventTimeSchema } from "./contracts";

describe("calendar edits", () => {
  test("a partial edit preserves every omitted field", () => {
    const before = {
      attendees: [{ email: "guest@example.test" }],
      availability: "free",
      description: "Roadmap",
      location: "Studio",
      recurrence: ["RRULE:FREQ=WEEKLY"],
      title: "Planning",
    };
    const edit = calendarEventPatchSchema.parse({ title: "Review" });
    expect({ ...before, ...edit }).toMatchObject({
      attendees: before.attendees,
      availability: before.availability,
      description: before.description,
      location: before.location,
      recurrence: before.recurrence,
      title: "Review",
    });
  });

  test("supports clearing an explicitly selected field", () => {
    const changes = calendarEventPatchSchema.parse({
      attendees: [],
      description: "",
      recurrence: [],
    });
    expect(changes).toMatchObject({
      attendees: [],
      description: "",
      recurrence: [],
    });
    expect(calendarEventPatchSchema.safeParse({}).success).toBeFalsy();
  });

  test("rejects invalid dates and reversed event times", () => {
    expect(
      calendarEventTimeSchema.safeParse({
        endDate: "2026-03-01",
        kind: "all-day",
        startDate: "2026-02-30",
      }).success
    ).toBeFalsy();
    expect(
      calendarEventTimeSchema.safeParse({
        end: "2026-10-23T11:00:00Z",
        kind: "timed",
        start: "2026-10-23T12:00:00Z",
        timeZone: "Europe/Berlin",
      }).success
    ).toBeFalsy();
  });

  test("keeps recurrence exclusions with date and time zone parameters", () => {
    const recurrence = [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;VALUE=DATE:20261026",
      "RDATE;TZID=Europe/Berlin:20261102T090000",
    ];
    expect(
      calendarEventPatchSchema.parse({ recurrence }).recurrence
    ).toStrictEqual(recurrence);
  });
});
