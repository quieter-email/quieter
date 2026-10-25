import { calendarEventSchema } from "@quieter/calendar";
import { describe, expect, it } from "vite-plus/test";

import {
  createCalendarEventChanges,
  createCalendarEventForm,
  parseCalendarEventForm,
} from "./calendar-event-form";

const recurringMeeting = calendarEventSchema.parse({
  attendees: [
    {
      email: "guest@example.com",
      name: "Guest",
      optional: true,
      organizer: false,
      response: "accepted",
      self: false,
    },
  ],
  availability: "busy",
  calendarId: "calendar",
  connectionId: "account",
  description: "An agenda",
  eventId: "occurrence",
  location: "Studio",
  meetingPending: false,
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  permissions: { delete: true, edit: true, respond: false },
  recurrence: [],
  recurringEventId: "series",
  reminders: { kind: "default" },
  status: "confirmed",
  time: {
    end: "2026-10-25T01:30:00Z",
    kind: "timed",
    start: "2026-10-25T00:30:00Z",
    timeZone: "Europe/Berlin",
  },
  title: "Weekly conversation",
  version: "current",
  visibility: "private",
});

describe("calendar event edit changes", () => {
  it("renames a recurring meeting without changing its time, guests or inherited settings", () => {
    const form = createCalendarEventForm(
      { event: recurringMeeting, kind: "edit", scope: "occurrence" },
      "Europe/Berlin"
    );
    const draft = parseCalendarEventForm(
      { ...form, title: "A new conversation" },
      recurringMeeting
    );
    const changes = createCalendarEventChanges({
      draft,
      original: recurringMeeting,
    });
    expect(changes?.title).toMatch(/new conversation/u);
    expect(changes).not.toHaveProperty("addMeeting");
    expect(changes).not.toHaveProperty("time");
    expect(changes).not.toHaveProperty("attendees");
    expect(changes).not.toHaveProperty("visibility");
    expect(changes).not.toHaveProperty("recurrence");
  });

  it("retains the saved instant through a repeated daylight saving hour", () => {
    const form = createCalendarEventForm(
      { event: recurringMeeting, kind: "edit", scope: "occurrence" },
      "Europe/Berlin"
    );
    const draft = parseCalendarEventForm(
      { ...form, description: "Updated agenda" },
      recurringMeeting
    );
    expect(draft.time).toMatchObject(recurringMeeting.time);
    expect(
      createCalendarEventChanges({ draft, original: recurringMeeting })
    ).not.toHaveProperty("time");
  });

  it("removes a video meeting only after the meeting control changes", () => {
    const form = createCalendarEventForm(
      { event: recurringMeeting, kind: "edit", scope: "occurrence" },
      "Europe/Berlin"
    );
    const draft = parseCalendarEventForm(
      { ...form, addMeeting: false },
      recurringMeeting
    );
    expect(
      createCalendarEventChanges({ draft, original: recurringMeeting })
    ).toMatchObject({ addMeeting: false });
  });

  it("skips an unchanged save instead of notifying guests", () => {
    const form = createCalendarEventForm(
      { event: recurringMeeting, kind: "edit", scope: "occurrence" },
      "Europe/Berlin"
    );
    const draft = parseCalendarEventForm(form, recurringMeeting);
    expect(
      createCalendarEventChanges({ draft, original: recurringMeeting })
    ).toBeUndefined();
  });
});
