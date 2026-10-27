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
        reminderItems: [
          { id: "unfinished", method: "email", minutesBefore: "unfinished" },
        ],
        reminderKind: "custom",
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

describe("calendar guest and reminder edits", () => {
  const original = calendarEventSchema.parse({
    ...recurringMeeting,
    reminders: {
      items: [
        { method: "notification", minutesBefore: 0 },
        { method: "email", minutesBefore: 1440 },
        { method: "notification", minutesBefore: 60 },
      ],
      kind: "custom",
    },
  });
  const form = createCalendarEventForm(
    { event: original, kind: "edit", scope: "occurrence" },
    "Europe/Berlin"
  );

  it("round trips every reminder without creating an event update", () => {
    const draft = parseCalendarEventForm(form, original);
    expect(draft.reminders).toMatchObject(original.reminders);
    expect(createCalendarEventChanges({ draft, original })).toBeUndefined();
  });

  it("saves additions and removals without restoring deleted reminders", () => {
    const draft = parseCalendarEventForm(
      {
        ...form,
        reminderItems: [
          ...form.reminderItems.slice(1),
          { id: "added", method: "email", minutesBefore: "120" },
        ],
      },
      original
    );
    expect(draft.reminders).toMatchObject({
      items: [
        { method: "email", minutesBefore: 1440 },
        { method: "notification", minutesBefore: 60 },
        { method: "email", minutesBefore: 120 },
      ],
      kind: "custom",
    });
  });

  it.each(["", " ", "unfinished", "-1", "40321", "1.5"])(
    "rejects invalid reminder input %j in any row",
    (minutesBefore) => {
      expect(() =>
        parseCalendarEventForm(
          {
            ...form,
            reminderItems: [
              ...form.reminderItems,
              { id: "invalid", method: "notification", minutesBefore },
            ],
          },
          original
        )
      ).toThrow(Error);
    }
  );

  it("rejects more reminders than the provider supports", () => {
    expect(() =>
      parseCalendarEventForm(
        {
          ...form,
          reminderItems: [...form.reminderItems, ...form.reminderItems],
        },
        original
      )
    ).toThrow(Error);
  });

  it("clears all reminders explicitly and can restore calendar defaults", () => {
    expect(
      parseCalendarEventForm({ ...form, reminderKind: "none" }, original)
        .reminders
    ).toMatchObject({ items: [], kind: "custom" });
    expect(
      parseCalendarEventForm({ ...form, reminderKind: "default" }, original)
        .reminders
    ).toMatchObject({ kind: "default" });
  });

  it("makes an existing guest required while preserving their name and email casing", () => {
    const draft = parseCalendarEventForm(
      { ...form, attendees: "GUEST@example.com", optionalGuestEmails: [] },
      original
    );
    expect(draft.attendees).toMatchObject([
      { email: "guest@example.com", name: "Guest", optional: false },
    ]);
    expect(createCalendarEventChanges({ draft, original })).toHaveProperty(
      "attendees"
    );
  });

  it("adds optional guests case insensitively and removes absent guests", () => {
    const draft = parseCalendarEventForm(
      {
        ...form,
        attendees: "NEW@example.com;new@EXAMPLE.com",
        optionalGuestEmails: ["new@example.com", "guest@example.com"],
      },
      original
    );
    expect(draft.attendees).toHaveLength(1);
    expect(draft.attendees).toMatchObject([
      { email: "NEW@example.com", optional: true },
    ]);
  });

  it("keeps incomplete guest input invalid instead of dropping it", () => {
    expect(() =>
      parseCalendarEventForm(
        { ...form, attendees: "guest@example.com, unfinished@" },
        original
      )
    ).toThrow(Error);
  });
});

describe("recurrence context changes", () => {
  it("rejects timed end rules after switching to all day", () => {
    const event = {
      ...recurringMeeting,
      recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261130T225959Z"],
    };
    const form = createCalendarEventForm(
      { event, kind: "edit", scope: "series" },
      "Europe/Berlin"
    );
    expect(
      parseCalendarEventForm({ ...form, title: "Renamed" }, event).recurrence
    ).toStrictEqual(event.recurrence);
    expect(() =>
      parseCalendarEventForm({ ...form, allDay: true }, event)
    ).toThrow(/all-day/u);
    expect(() =>
      parseCalendarEventForm(
        { ...form, recurrence: ["RRULE:FREQ=WEEKLY;COUNT=0"] },
        event
      )
    ).toThrow(/positive/u);
  });
});
