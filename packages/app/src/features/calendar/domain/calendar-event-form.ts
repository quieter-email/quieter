import { calendarEventDraftSchema } from "@quieter/calendar";
import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarEventTime,
  CalendarRef,
} from "@quieter/calendar";
import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";

export type CalendarEditor =
  | {
      kind: "create";
      ref: CalendarRef;
      time: CalendarEventTime;
      operationId: string;
    }
  | { kind: "edit"; event: CalendarEvent; scope: "occurrence" | "series" };

export type CalendarEventForm = {
  addMeeting: boolean;
  allDay: boolean;
  attendees: string;
  availability: CalendarEventDraft["availability"];
  calendarKey: string;
  color: string | null;
  description: string;
  endDate: string;
  endTime: string;
  location: string;
  recurrence: string[];
  reminderKind: "default" | "none" | "custom";
  reminderMethod: "notification" | "email";
  reminderMinutes: string;
  startDate: string;
  startTime: string;
  timeZone: string;
  title: string;
  visibility: CalendarEventDraft["visibility"];
};

export const addCalendarDays = (date: string, count: number) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};

export const getCalendarRefKey = (ref: CalendarRef) =>
  JSON.stringify([ref.connectionId, ref.calendarId]);

export const getCalendarEventKey = (
  event: Pick<CalendarEvent, "connectionId" | "calendarId" | "eventId">
) => JSON.stringify([event.connectionId, event.calendarId, event.eventId]);

export const createCalendarEventForm = (
  editor: CalendarEditor,
  timeZone: string
): CalendarEventForm => {
  const event = editor.kind === "edit" ? editor.event : undefined;
  const time = editor.kind === "edit" ? editor.event.time : editor.time;
  const zone = time.kind === "timed" ? time.timeZone : timeZone;
  const start =
    time.kind === "timed"
      ? getZonedDateTimeFields({ instant: time.start, timeZone: zone })
      : { date: time.startDate, time: "09:00" };
  const end =
    time.kind === "timed"
      ? getZonedDateTimeFields({ instant: time.end, timeZone: zone })
      : { date: addCalendarDays(time.endDate, -1), time: "10:00" };
  const reminder =
    event?.reminders.kind === "custom" ? event.reminders.items[0] : undefined;
  let reminderKind: CalendarEventForm["reminderKind"] = "default";
  if (event?.reminders.kind === "custom") {
    reminderKind = reminder ? "custom" : "none";
  }
  return {
    addMeeting: Boolean(event?.meetingUrl || event?.meetingPending),
    allDay: time.kind === "all-day",
    attendees: event?.attendees.map((guest) => guest.email).join(", ") ?? "",
    availability: event?.availability ?? "busy",
    calendarKey: getCalendarRefKey(
      editor.kind === "edit" ? editor.event : editor.ref
    ),
    color: event?.colorOverride ?? null,
    description: event?.description ?? "",
    endDate: end.date,
    endTime: end.time.slice(0, 5),
    location: event?.location ?? "",
    recurrence: event?.recurrence ?? [],
    reminderKind,
    reminderMethod: reminder?.method ?? "notification",
    reminderMinutes: String(reminder?.minutesBefore ?? 30),
    startDate: start.date,
    startTime: start.time.slice(0, 5),
    timeZone: zone,
    title: event?.title ?? "",
    visibility: event?.visibility ?? "default",
  };
};

export const parseCalendarEventForm = (
  form: CalendarEventForm,
  original?: CalendarEvent
): CalendarEventDraft => {
  const guests = form.attendees
    .split(/[,;\n]/u)
    .map((email) => email.trim())
    .filter(Boolean);
  const attendees = [...new Set(guests)].map((email) => {
    const guest = original?.attendees.find(
      (attendee) => attendee.email === email
    );
    return { email, name: guest?.name, optional: guest?.optional ?? false };
  });
  const originalTime = original?.time;
  const originalStart =
    originalTime?.kind === "timed"
      ? getZonedDateTimeFields({
          instant: originalTime.start,
          timeZone: originalTime.timeZone,
        })
      : undefined;
  const originalEnd =
    originalTime?.kind === "timed"
      ? getZonedDateTimeFields({
          instant: originalTime.end,
          timeZone: originalTime.timeZone,
        })
      : undefined;
  const unchangedTimed =
    !form.allDay &&
    originalTime?.kind === "timed" &&
    originalTime.timeZone === form.timeZone &&
    originalStart?.date === form.startDate &&
    originalStart.time === form.startTime &&
    originalEnd?.date === form.endDate &&
    originalEnd.time === form.endTime;
  let time: CalendarEventTime;
  if (unchangedTimed) {
    time = originalTime;
  } else {
    time = form.allDay
      ? {
          endDate: addCalendarDays(form.endDate, 1),
          kind: "all-day",
          startDate: form.startDate,
        }
      : {
          end: calendarWallTimeToInstant({
            date: form.endDate,
            time: form.endTime,
            timeZone: form.timeZone,
          }),
          kind: "timed",
          start: calendarWallTimeToInstant({
            date: form.startDate,
            time: form.startTime,
            timeZone: form.timeZone,
          }),
          timeZone: form.timeZone,
        };
  }
  let reminders: CalendarEventDraft["reminders"] = { kind: "default" };
  if (form.reminderKind === "none") {
    reminders = { items: [], kind: "custom" };
  } else if (form.reminderKind === "custom") {
    const previous =
      original?.reminders.kind === "custom" ? original.reminders.items : [];
    reminders = {
      items: [
        {
          method: form.reminderMethod,
          minutesBefore: Number(form.reminderMinutes),
        },
        ...previous.slice(1),
      ],
      kind: "custom",
    };
  }
  return calendarEventDraftSchema.parse({
    addMeeting: form.addMeeting,
    attendees,
    availability: form.availability,
    color: form.color,
    description: form.description,
    location: form.location,
    recurrence: form.recurrence,
    reminders,
    time,
    title: form.title,
    visibility: form.visibility,
  });
};

export const createCalendarEventChanges = ({
  draft,
  original,
}: {
  draft: CalendarEventDraft;
  original: CalendarEvent;
}): CalendarEventPatch | undefined => {
  const changes: CalendarEventPatch = {};
  if (draft.title !== original.title) {
    changes.title = draft.title;
  }
  if (
    draft.color !== undefined &&
    draft.color !== (original.colorOverride ?? null)
  ) {
    changes.color = draft.color;
  }
  if (draft.description !== original.description) {
    changes.description = draft.description;
  }
  if (draft.location !== original.location) {
    changes.location = draft.location;
  }
  if (draft.availability !== original.availability) {
    changes.availability = draft.availability;
  }
  if (draft.visibility !== original.visibility) {
    changes.visibility = draft.visibility;
  }
  if (
    draft.addMeeting !== Boolean(original.meetingUrl || original.meetingPending)
  ) {
    changes.addMeeting = draft.addMeeting;
  }
  if (JSON.stringify(draft.time) !== JSON.stringify(original.time)) {
    changes.time = draft.time;
  }
  if (
    JSON.stringify(draft.recurrence) !== JSON.stringify(original.recurrence)
  ) {
    changes.recurrence = draft.recurrence;
  }
  if (JSON.stringify(draft.reminders) !== JSON.stringify(original.reminders)) {
    changes.reminders = draft.reminders;
  }
  const originalGuests = original.attendees.map(
    ({ email, name, optional }) => ({ email, name, optional })
  );
  if (JSON.stringify(draft.attendees) !== JSON.stringify(originalGuests)) {
    changes.attendees = draft.attendees;
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
};

export const getCalendarTimeZoneOptions = (selected: string) =>
  [...new Set([selected, "UTC", ...Intl.supportedValuesOf("timeZone")])]
    .toSorted()
    .map((zone) => ({
      label: zone.replaceAll("_", " "),
      value: zone,
    }));
