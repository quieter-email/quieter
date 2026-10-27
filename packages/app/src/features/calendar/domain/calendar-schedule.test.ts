import { calendarEventSchema, calendarSummarySchema } from "@quieter/calendar";
import type { CalendarEvent } from "@quieter/calendar";
import { describe, expect, it } from "vite-plus/test";

import {
  createCalendarEventForm,
  getCalendarRefKey,
} from "./calendar-event-form";
import { getCalendarScheduleItems } from "./calendar-schedule";

const calendar = calendarSummarySchema.parse({
  access: "owner",
  calendarId: "work",
  color: "#336699",
  connectionId: "account",
  name: "Work",
  primary: true,
  selected: true,
  supportsMeetings: true,
  timeZone: "Europe/Berlin",
});
const event = calendarEventSchema.parse({
  attendees: [],
  availability: "busy",
  calendarId: calendar.calendarId,
  color: "#cc6633",
  connectionId: calendar.connectionId,
  description: "",
  eventId: "workshop",
  location: "Studio",
  meetingPending: false,
  permissions: { delete: true, edit: true, respond: false },
  recurrence: [],
  reminders: { kind: "default" },
  status: "confirmed",
  time: {
    end: "2026-10-27T11:00:00Z",
    kind: "timed",
    start: "2026-10-27T09:00:00Z",
    timeZone: "Europe/Berlin",
  },
  title: "Team workshop",
  version: "current",
  visibility: "default",
});
const form = createCalendarEventForm(
  { kind: "create", operationId: "creation", ref: calendar, time: event.time },
  "Europe/Berlin"
);
const context = {
  calendars: [calendar],
  dates: ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"],
  events: [event],
  timeZone: "Europe/Berlin",
};

describe("calendar schedule creation previews", () => {
  it("keeps the configured time visible before unrelated fields are valid", () => {
    const items = getCalendarScheduleItems({
      ...context,
      draft: {
        form: {
          ...form,
          attendees: "unfinished@",
          location: "Garden room",
          reminderKind: "custom",
          reminderMinutes: "unfinished",
          title: "",
        },
        id: "draft:creation",
      },
    });
    const preview = items.find((item) => item.preview);
    expect(preview).toMatchObject({
      allDay: false,
      date: "2026-10-27",
      detail: "Garden room",
      endMinute: 720,
      startMinute: 600,
    });
    expect(preview?.title).toMatch(/\S/u);
    expect(items.filter((item) => !item.preview)).toHaveLength(1);
  });

  it.each([
    {
      changes: { endTime: "09:00", startTime: "10:00" },
      problem: "reversed time",
    },
    {
      changes: { endTime: "10:00", startTime: "10:00" },
      problem: "equal times",
    },
    { changes: { endDate: "" }, problem: "an incomplete date" },
    {
      changes: { allDay: true, endDate: "2026-02-30", startDate: "2026-02-28" },
      problem: "an impossible all-day date",
    },
  ])("hides $problem without removing saved events", ({ changes }) => {
    const items = getCalendarScheduleItems({
      ...context,
      draft: { form: { ...form, ...changes }, id: "draft:creation" },
    });
    expect(items.some((item) => item.preview)).toBeFalsy();
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe(event.title);
  });

  it("uses the same all-day segmentation for saved and configured multi-day events", () => {
    const items = getCalendarScheduleItems({
      ...context,
      draft: {
        form: {
          ...form,
          allDay: true,
          endDate: "2026-10-29",
          startDate: "2026-10-27",
        },
        id: "draft:creation",
      },
      events: [
        {
          ...event,
          time: {
            endDate: "2026-10-30",
            kind: "all-day",
            startDate: "2026-10-27",
          },
        },
      ],
    });
    for (const date of context.dates.slice(0, 3)) {
      for (const preview of [true, undefined]) {
        expect(
          items.find((item) => item.date === date && item.preview === preview)
        ).toMatchObject({
          allDay: true,
          date,
          endMinute: 1440,
          startMinute: 0,
        });
      }
    }
    expect(items.filter((item) => item.date === "2026-10-30")).toHaveLength(0);
  });

  it("shares midnight splitting and display-zone conversion between saved and draft times", () => {
    const overnight: CalendarEvent = {
      ...event,
      time: {
        end: "2026-10-28T01:00:00Z",
        kind: "timed",
        start: "2026-10-27T22:30:00Z",
        timeZone: "Europe/Berlin",
      },
    };
    const overnightForm = createCalendarEventForm(
      {
        kind: "create",
        operationId: "creation",
        ref: calendar,
        time: overnight.time,
      },
      "Europe/Berlin"
    );
    for (const [timeZone, startMinute, endMinute] of [
      ["UTC", 1350, 60],
      ["Europe/Berlin", 1410, 120],
    ] satisfies [string, number, number][]) {
      const items = getCalendarScheduleItems({
        ...context,
        draft: { form: overnightForm, id: "draft:creation" },
        events: [overnight],
        timeZone,
      });
      expect(items).toHaveLength(4);
      for (const preview of [true, undefined]) {
        const segments = items.filter((item) => item.preview === preview);
        expect(segments).toMatchObject([
          { date: "2026-10-27", endMinute: 1440, startMinute },
          { date: "2026-10-28", endMinute, startMinute: 0 },
        ]);
      }
    }
  });

  it("honors overrides and restores the selected calendar's inherited color", () => {
    const otherCalendar = {
      ...calendar,
      color: "#339966",
      connectionId: "other-account",
    };
    const customColor = "#993366";
    const overrideItems = getCalendarScheduleItems({
      ...context,
      calendars: [otherCalendar, calendar],
      draft: { form: { ...form, color: customColor }, id: "draft:creation" },
      events: [{ ...event, colorOverride: customColor, status: "tentative" }],
    });
    expect(overrideItems).toMatchObject([
      {
        color: customColor,
        detail: event.location,
        title: event.title,
        tone: "warning",
      },
      { color: customColor, preview: true },
    ]);
    const inheritedItems = getCalendarScheduleItems({
      ...context,
      calendars: [otherCalendar, calendar],
      draft: {
        form: {
          ...form,
          calendarKey: getCalendarRefKey(otherCalendar),
          color: null,
        },
        id: "draft:creation",
      },
    });
    expect(inheritedItems).toMatchObject([
      { color: calendar.color },
      { color: otherCalendar.color, preview: true },
    ]);
    const fallbackItems = getCalendarScheduleItems({
      ...context,
      calendars: [],
    });
    expect(fallbackItems[0]?.color).toBe(event.color);
  });
});
