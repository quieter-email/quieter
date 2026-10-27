import { calendarEventSchema } from "@quieter/calendar";
import { describe, expect, it } from "vite-plus/test";

import {
  createCalendarEventChanges,
  createCalendarEventForm,
  parseCalendarEventForm,
  parseCalendarEventFormTime,
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

describe("calendar event form time", () => {
  const form = createCalendarEventForm(
    { event: recurringMeeting, kind: "edit", scope: "occurrence" },
    "Europe/Berlin"
  );

  it("preserves repeated-hour instants while unrelated fields are incomplete", () => {
    const time = parseCalendarEventFormTime(
      {
        ...form,
        attendees: "guest@",
        reminderKind: "custom",
        reminderMinutes: "unfinished",
        title: "",
      },
      recurringMeeting
    );
    expect(time).toMatchObject(recurringMeeting.time);
  });

  it("converts an inclusive all-day end date to the exclusive time contract", () => {
    expect(
      parseCalendarEventFormTime({
        ...form,
        allDay: true,
        endDate: "2026-10-27",
        startDate: "2026-10-25",
      })
    ).toMatchObject({
      endDate: "2026-10-28",
      kind: "all-day",
      startDate: "2026-10-25",
    });
  });

  it.each([
    {
      changes: { allDay: true, endDate: "2026-02-30", startDate: "2026-02-28" },
      problem: "an impossible all-day end date before date arithmetic",
    },
    {
      changes: { allDay: true, endDate: "2026-10-24" },
      problem: "an all-day end before the start",
    },
    {
      changes: { endTime: "09:00", startTime: "10:00" },
      problem: "a timed end before the start",
    },
    {
      changes: { endTime: "10:00", startTime: "10:00" },
      problem: "a zero-duration timed event",
    },
    {
      changes: { endDate: "", startTime: "" },
      problem: "partially entered date and time fields",
    },
  ])("rejects $problem", ({ changes }) => {
    expect(() => parseCalendarEventFormTime({ ...form, ...changes })).toThrow(
      Error
    );
  });
});

describe("calendar event edit changes", () => {
  it("deduplicates guest email casing without changing saved guest metadata", () => {
    const form = createCalendarEventForm(
      { event: recurringMeeting, kind: "edit", scope: "occurrence" },
      "Europe/Berlin"
    );
    const draft = parseCalendarEventForm(
      { ...form, attendees: "GUEST@example.com; guest@EXAMPLE.com" },
      recurringMeeting
    );
    expect(draft.attendees).toHaveLength(1);
    expect(draft.attendees[0]).toMatchObject({
      email: recurringMeeting.attendees[0]?.email,
      name: "Guest",
      optional: true,
    });
    expect(
      createCalendarEventChanges({ draft, original: recurringMeeting })
    ).toBeUndefined();
  });

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

  it("keeps an event color override on an unrelated edit and can restore calendar inheritance", () => {
    const original = {
      ...recurringMeeting,
      color: "#7986cb",
      colorOverride: "#7986cb",
    };
    const form = createCalendarEventForm(
      { event: original, kind: "edit", scope: "occurrence" },
      "Europe/Berlin"
    );
    const renamed = parseCalendarEventForm(
      { ...form, title: "Updated meeting" },
      original
    );
    expect(
      createCalendarEventChanges({ draft: renamed, original })
    ).not.toHaveProperty("color");
    const inherited = parseCalendarEventForm(
      { ...form, color: null },
      original
    );
    expect(
      createCalendarEventChanges({ draft: inherited, original })
    ).toMatchObject({ color: null });
  });
});
