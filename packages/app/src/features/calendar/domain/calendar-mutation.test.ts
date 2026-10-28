import { calendarEventSchema } from "@quieter/calendar";
import type { CalendarEventTime } from "@quieter/calendar";
import { describe, expect, it } from "vite-plus/test";

import { createCalendarEventDisplay } from "./calendar-mutation";
import type { CalendarMutation } from "./calendar-mutation";

const event = calendarEventSchema.parse({
  attendees: [],
  availability: "busy",
  calendarId: "work",
  color: "#336699",
  connectionId: "account",
  description: "Bring the roadmap",
  eventId: "planning",
  location: "Studio",
  meetingPending: false,
  permissions: { delete: true, edit: true, respond: false },
  recurrence: [],
  reminders: { kind: "default" },
  status: "confirmed",
  time: {
    end: "2026-10-27T11:00:00Z",
    kind: "timed",
    start: "2026-10-27T10:00:00Z",
    timeZone: "Europe/Berlin",
  },
  title: "Planning",
  version: "before",
  visibility: "private",
});
const time: CalendarEventTime = {
  end: "2026-10-28T14:00:00Z",
  kind: "timed",
  start: "2026-10-28T13:00:00Z",
  timeZone: "Europe/Berlin",
};
const variables: CalendarMutation = {
  changes: { time },
  event,
  kind: "update",
};

describe("pending calendar time display", () => {
  it("shows a pending move without modifying the confirmed record", () => {
    const display = createCalendarEventDisplay({ isPending: true, variables });
    expect(display(event)).toMatchObject({
      description: event.description,
      location: event.location,
      time,
      version: event.version,
      visibility: event.visibility,
    });
    expect(event.time).toMatchObject({ start: "2026-10-27T10:00:00Z" });
  });

  it("keeps another event, calendar, or account unchanged", () => {
    const display = createCalendarEventDisplay({ isPending: true, variables });
    for (const other of [
      { ...event, eventId: "another-event" },
      { ...event, calendarId: "another-calendar" },
      { ...event, connectionId: "another-account" },
    ]) {
      expect(display(other)).toBe(other);
    }
  });

  it("preserves fresh server metadata while the requested time is pending", () => {
    const fresh = {
      ...event,
      description: "Updated in another window",
      title: "Updated planning",
      version: "fresh",
    };
    const display = createCalendarEventDisplay({ isPending: true, variables });
    expect(display(fresh)).toMatchObject({
      description: fresh.description,
      time,
      title: fresh.title,
      version: fresh.version,
    });
    const settled = createCalendarEventDisplay({
      isPending: false,
      variables,
    });
    expect(settled(fresh)).toBe(fresh);
  });

  it("reveals confirmed data when a request fails or finishes", () => {
    const display = createCalendarEventDisplay({ isPending: false, variables });
    expect(display(event)).toBe(event);
    expect(
      createCalendarEventDisplay({ isPending: true, variables: undefined })(
        event
      )
    ).toBe(event);
  });

  it("leaves unrelated mutation fields and actions to their established flow", () => {
    const actions: CalendarMutation[] = [
      { event, kind: "delete" },
      { event, kind: "respond", response: "accepted" },
      { changes: { location: "Garden" }, event, kind: "update" },
      { changes: { time, title: "Renamed" }, event, kind: "update" },
    ];
    for (const action of actions) {
      const display = createCalendarEventDisplay({
        isPending: true,
        variables: action,
      });
      expect(display(event)).toBe(event);
    }
  });
});
