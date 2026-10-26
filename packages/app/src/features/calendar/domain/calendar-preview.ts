import type {
  CalendarAccount,
  CalendarEvent,
  CalendarSummary,
} from "@quieter/calendar";
import {
  calendarWallTimeToInstant,
  getCalendarDates,
} from "@quieter/calendar/time";

import { addCalendarDays } from "./calendar-event-form";

export const calendarPreviewEventColors = [
  "#7986cb",
  "#33b679",
  "#f6bf26",
  "#d50000",
  "#8e24aa",
];

export const calendarPreviewAccounts: CalendarAccount[] = [
  {
    email: "alex@example.com",
    id: "preview-calendar-account",
    mailboxId: "preview-mailbox",
    name: "Alex Morgan",
    status: "connected",
  },
];

export const calendarPreviewCalendars: CalendarSummary[] = [
  {
    access: "owner",
    calendarId: "preview-work",
    color: "#7986cb",
    connectionId: "preview-calendar-account",
    name: "Work",
    primary: true,
    selected: true,
    supportsMeetings: true,
    timeZone: "Europe/Berlin",
  },
  {
    access: "owner",
    calendarId: "preview-personal",
    color: "#33b679",
    connectionId: "preview-calendar-account",
    name: "Personal",
    primary: false,
    selected: true,
    supportsMeetings: false,
    timeZone: "Europe/Berlin",
  },
];

export const createCalendarPreviewEvents = ({
  date,
  timeZone,
}: {
  date: string;
  timeZone: string;
}): CalendarEvent[] => {
  const dates = getCalendarDates({ date, view: "week" });
  const monday = dates[0] ?? date;
  const definitions = [
    {
      day: 0,
      duration: 60,
      hour: 9,
      location: "Focus time",
      personal: false,
      title: "A quiet start",
    },
    {
      day: 0,
      duration: 45,
      hour: 11,
      location: "Studio",
      personal: false,
      title: "Weekly planning",
    },
    {
      day: 1,
      duration: 90,
      hour: 10,
      location: "Meeting room 2",
      personal: false,
      title: "Design review",
    },
    {
      day: 1,
      duration: 60,
      hour: 15,
      location: "Riverside",
      personal: true,
      title: "A walk outside",
    },
    {
      day: 2,
      duration: 120,
      hour: 9,
      location: "Focus time",
      personal: false,
      title: "Time to make things",
    },
    {
      day: 2,
      duration: 45,
      hour: 13,
      location: "Studio",
      personal: false,
      title: "Catch up with Maya",
    },
    {
      day: 3,
      duration: 60,
      hour: 10,
      location: "Meeting room 1",
      personal: false,
      title: "Product conversations",
    },
    {
      day: 3,
      duration: 90,
      hour: 14,
      location: "Library",
      personal: true,
      title: "Read, think, explore",
    },
    {
      day: 4,
      duration: 60,
      hour: 10,
      location: "Studio",
      personal: false,
      title: "Team catch up",
    },
    {
      day: 4,
      duration: 60,
      hour: 13,
      location: "The corner café",
      personal: true,
      title: "Lunch with Sam",
    },
  ];
  const events: CalendarEvent[] = definitions.map((definition, index) => {
    const eventDate = addCalendarDays(monday, definition.day);
    const start = calendarWallTimeToInstant({
      date: eventDate,
      time: `${String(definition.hour).padStart(2, "0")}:00`,
      timeZone,
    });
    return {
      attendees: definition.personal
        ? []
        : [
            {
              email: "alex@example.com",
              name: "Alex",
              optional: false,
              organizer: true,
              response: "accepted",
              self: true,
            },
          ],
      availability: "busy",
      calendarId: definition.personal ? "preview-personal" : "preview-work",
      connectionId: "preview-calendar-account",
      description: definition.personal
        ? "Make a little room for yourself."
        : "Space to discuss what matters and decide what comes next.",
      eventId: `preview-event-${index}`,
      location: definition.location,
      meetingPending: false,
      organizer: { email: "alex@example.com", name: "Alex", self: true },
      permissions: { delete: true, edit: true, respond: false },
      recurrence: [],
      reminders: { kind: "default" },
      status: "confirmed",
      time: {
        end: new Date(
          Date.parse(start) + definition.duration * 60_000
        ).toISOString(),
        kind: "timed",
        start,
        timeZone,
      },
      title: definition.title,
      version: `preview-${index}`,
      visibility: "default",
    };
  });
  const firstEvent = events.at(0);
  if (firstEvent) {
    events.push({
      ...firstEvent,
      calendarId: "preview-personal",
      description: "A sample all-day event. You can edit or move it.",
      eventId: "preview-all-day",
      location: "",
      time: {
        endDate: addCalendarDays(monday, 3),
        kind: "all-day",
        startDate: addCalendarDays(monday, 2),
      },
      title: "A day worth celebrating",
      version: "preview-all-day",
    });
  }
  return events;
};
