import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type {
  CalendarEvent,
  CalendarEventPatch,
  CalendarEventRef,
  CalendarEventTime,
  CalendarMutationResult,
  CalendarRef,
  CalendarSummary,
  calendarCreateInputSchema,
  calendarDeleteInputSchema,
  calendarEventsInputSchema,
  calendarRespondInputSchema,
  calendarUpdateInputSchema,
  calendarUpdateColorInputSchema,
} from "@quieter/calendar";
import {
  calendarColorSchema,
  calendarEventTimeSchema,
} from "@quieter/calendar";
import { calendarInstantToWallTime } from "@quieter/calendar/time";
import { resolveCalendarTimeZone } from "@quieter/calendar/time-zones";
import { convert } from "html-to-text";
import { z } from "zod";

import {
  readBoundedMicrosoftContent,
  requestMicrosoftGraph,
} from "../connectors/microsoft-graph";
import type { MicrosoftGraphAuth } from "../connectors/microsoft-graph";
import { runAuthorizedConnector } from "../connectors/runtime";
import {
  fromMicrosoftRecurrence,
  microsoftRecurrenceSchema,
  toMicrosoftRecurrence,
} from "./microsoft-recurrence";

const emailSchema = z.object({
  address: z.string().optional(),
  name: z.string().optional(),
});
const calendarSchema = z.object({
  allowedOnlineMeetingProviders: z.array(z.string()).optional(),
  canEdit: z.boolean(),
  hexColor: z.string().optional(),
  id: z.string().min(1),
  isDefaultCalendar: z.boolean().optional(),
  name: z.string(),
  owner: emailSchema.optional(),
});
const dateTimeSchema = z.object({ dateTime: z.string(), timeZone: z.string() });
const eventSchema = z.object({
  "@odata.etag": z.string().min(1),
  attendees: z
    .array(
      z.object({
        emailAddress: emailSchema,
        status: z.object({ response: z.string() }).optional(),
        type: z.string(),
      })
    )
    .default([]),
  body: z.object({ content: z.string(), contentType: z.string() }).optional(),
  end: dateTimeSchema,
  id: z.string().min(1),
  isAllDay: z.boolean(),
  isCancelled: z.boolean().optional(),
  isOnlineMeeting: z.boolean().optional(),
  isOrganizer: z.boolean(),
  isReminderOn: z.boolean().optional(),
  location: z.object({ displayName: z.string().optional() }).optional(),
  onlineMeeting: z.object({ joinUrl: z.string().optional() }).nullish(),
  organizer: z.object({ emailAddress: emailSchema }).optional(),
  originalEndTimeZone: z.string().optional(),
  originalStartTimeZone: z.string().optional(),
  recurrence: microsoftRecurrenceSchema.nullish(),
  reminderMinutesBeforeStart: z.number().int().optional(),
  responseStatus: z.object({ response: z.string() }).optional(),
  sensitivity: z.string().optional(),
  seriesMasterId: z.string().nullish(),
  showAs: z.string().optional(),
  start: dateTimeSchema,
  subject: z.string().nullish(),
  webLink: z.string().optional(),
});
type MicrosoftEvent = z.infer<typeof eventSchema>;
type UserRequest = { userId: string; signal?: AbortSignal };
type CalendarContext = MicrosoftGraphAuth &
  CalendarRef & { calendar: z.infer<typeof calendarSchema> };
const prefer =
  'outlook.timezone="UTC", outlook.body-content-type="text", IdType="ImmutableId"';

const readPages = async <T extends z.ZodType>(
  input: MicrosoftGraphAuth & { path: string; schema: T }
): Promise<z.infer<T>[]> => {
  const values: z.infer<T>[] = [];
  const visited = new Set<string>();
  let path: string | undefined = input.path;
  while (path) {
    if (visited.has(path) || visited.size >= 20) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "There are too many calendar results. Choose a shorter date range.",
      });
    }
    visited.add(path);
    const response = await requestMicrosoftGraph({ ...input, path, prefer });
    const page: { value: z.infer<T>[]; "@odata.nextLink"?: string } = z
      .object({
        "@odata.nextLink": z.string().optional(),
        value: z.array(input.schema),
      })
      .parse(
        JSON.parse(await readBoundedMicrosoftContent(response, 4 * 1024 * 1024))
      );
    values.push(...page.value);
    path = page["@odata.nextLink"];
  }
  return values;
};

const toSummary = (
  calendar: z.infer<typeof calendarSchema>,
  connectionId: string
): CalendarSummary => {
  const color = calendarColorSchema.safeParse(calendar.hexColor);
  return {
    access: calendar.canEdit ? "write" : "read",
    calendarId: calendar.id,
    connectionId,
    ...(color.success ? { color: color.data } : {}),
    name: calendar.name,
    primary: calendar.isDefaultCalendar ?? false,
    selected: true,
    supportsMeetings:
      calendar.allowedOnlineMeetingProviders?.includes("teamsForBusiness") ??
      false,
    timeZone: "UTC",
  };
};

const toEvent = (
  context: CalendarContext,
  event: MicrosoftEvent
): CalendarEvent => {
  const originalZone = resolveCalendarTimeZone(event.originalStartTimeZone);
  const time: CalendarEventTime = event.isAllDay
    ? {
        endDate: event.end.dateTime.slice(0, 10),
        kind: "all-day",
        startDate: event.start.dateTime.slice(0, 10),
      }
    : {
        end: `${event.end.dateTime.replace(/Z$/u, "")}Z`,
        kind: "timed",
        start: `${event.start.dateTime.replace(/Z$/u, "")}Z`,
        timeZone: originalZone ?? "UTC",
      };
  const writable = context.calendar.canEdit && event.isCancelled !== true;
  const safeOrganizerWrite = event.isOrganizer && event.attendees.length === 0;
  const response = event.responseStatus?.response;
  const meetingUrl = z.url().safeParse(event.onlineMeeting?.joinUrl);
  const webUrl = z.url().safeParse(event.webLink);
  const color = calendarColorSchema.safeParse(context.calendar.hexColor);
  let eventStatus: CalendarEvent["status"] = "confirmed";
  if (event.isCancelled === true) {
    eventStatus = "cancelled";
  } else if (event.showAs === "tentative") {
    eventStatus = "tentative";
  }
  return {
    availability: event.showAs === "free" ? "free" : "busy",
    calendarId: context.calendarId,
    connectionId: context.connectionId,
    description:
      event.body?.contentType.toLowerCase() === "html"
        ? convert(event.body.content, { wordwrap: false })
        : (event.body?.content ?? ""),
    eventId: event.id,
    location: event.location?.displayName ?? "",
    meetingPending: event.isOnlineMeeting === true && !meetingUrl.success,
    ...(meetingUrl.success && new URL(meetingUrl.data).protocol === "https:"
      ? { meetingUrl: meetingUrl.data }
      : {}),
    ...(webUrl.success && new URL(webUrl.data).protocol === "https:"
      ? { webUrl: webUrl.data }
      : {}),
    ...(color.success ? { color: color.data } : {}),
    attendees: event.attendees.flatMap((attendee) => {
      const email = attendee.emailAddress.address;
      if (!email) {
        return [];
      }
      const self =
        email.toLowerCase() === context.calendar.owner?.address?.toLowerCase();
      const status = self ? response : attendee.status?.response;
      let attendeeResponse: CalendarEvent["attendees"][number]["response"] =
        "needs-action";
      if (status === "accepted" || status === "declined") {
        attendeeResponse = status;
      } else if (status === "tentativelyAccepted") {
        attendeeResponse = "tentative";
      }
      return [
        {
          email,
          name: attendee.emailAddress.name,
          optional: attendee.type === "optional",
          organizer:
            email.toLowerCase() ===
            event.organizer?.emailAddress.address?.toLowerCase(),
          response: attendeeResponse,
          self,
        },
      ];
    }),
    organizer: event.organizer
      ? {
          email: event.organizer.emailAddress.address,
          name: event.organizer.emailAddress.name,
          self: event.isOrganizer,
        }
      : undefined,
    permissions: {
      delete: writable && safeOrganizerWrite,
      edit: writable && safeOrganizerWrite,
      respond: writable && !event.isOrganizer,
    },
    recurrence: fromMicrosoftRecurrence(event.recurrence, time),
    recurringEventId: event.seriesMasterId ?? undefined,
    reminders: {
      items:
        event.isReminderOn === true
          ? [
              {
                method: "notification",
                minutesBefore: Math.max(
                  0,
                  Math.min(40_320, event.reminderMinutesBeforeStart ?? 15)
                ),
              },
            ]
          : [],
      kind: "custom",
    },
    status: eventStatus,
    time: calendarEventTimeSchema.parse(time),
    title: event.subject ?? "Untitled event",
    version: event["@odata.etag"],
    visibility:
      event.sensitivity === "private" ||
      event.sensitivity === "confidential" ||
      event.sensitivity === "personal"
        ? "private"
        : "default",
  };
};

const withCalendar = async <T>(
  input: CalendarRef & UserRequest,
  mutates: boolean,
  run: (context: CalendarContext) => Promise<T>
): Promise<T> =>
  await runAuthorizedConnector(
    { ...input, mutates, provider: "microsoft_calendar" },
    async (accessToken, signal) => {
      const path =
        input.calendarId === "primary"
          ? "me/calendar"
          : `me/calendars/${encodeURIComponent(input.calendarId)}`;
      const response = await requestMicrosoftGraph({
        accessToken,
        path,
        signal,
      });
      const calendar = calendarSchema.parse(
        JSON.parse(await readBoundedMicrosoftContent(response, 64 * 1024))
      );
      if (mutates && !calendar.canEdit) {
        throw new ORPCError("FORBIDDEN", {
          message:
            "This calendar is read only. Choose a calendar you can edit.",
        });
      }
      return await run({
        accessToken,
        calendar,
        calendarId: calendar.id,
        connectionId: input.connectionId,
        signal,
      });
    }
  );

const readEvent = async (
  context: CalendarContext,
  eventId: string
): Promise<MicrosoftEvent> => {
  const path = `me/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(eventId)}`;
  const response = await requestMicrosoftGraph({ ...context, path, prefer });
  const event = eventSchema.parse(
    JSON.parse(await readBoundedMicrosoftContent(response, 1024 * 1024))
  );
  if (event.isCancelled === true) {
    throw new ORPCError("NOT_FOUND", {
      message: "This event is no longer available. Refresh your calendar.",
    });
  }
  if (
    event.isAllDay &&
    event.originalStartTimeZone &&
    /^[\w /+().:-]+$/u.test(event.originalStartTimeZone)
  ) {
    // Date-only events must be read in their original zone to retain their dates.
    const original = await requestMicrosoftGraph({
      ...context,
      path,
      prefer: `outlook.timezone="${event.originalStartTimeZone}", outlook.body-content-type="text", IdType="ImmutableId"`,
    });
    return eventSchema.parse(
      JSON.parse(await readBoundedMicrosoftContent(original, 1024 * 1024))
    );
  }
  return event;
};

const eventChanges = (
  changes: CalendarEventPatch,
  current?: MicrosoftEvent
): Record<string, unknown> => {
  if (
    (changes.attendees?.length ?? 0) > 0 ||
    (current?.attendees.length ?? 0) > 0
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Open this event in your calendar account to change meetings with guests. Those changes send invitations or updates.",
    });
  }
  if (changes.color !== undefined && changes.color !== null) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Event colors are not supported for this calendar.",
    });
  }
  if (current?.isOnlineMeeting === true && changes.description !== undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Open this meeting in your calendar account to edit its description without removing meeting details.",
    });
  }
  if (changes.addMeeting === false && current?.isOnlineMeeting === true) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Open this event in your calendar account to remove its meeting link.",
    });
  }
  const body: Record<string, unknown> = {};
  if (changes.title !== undefined) {
    body.subject = changes.title;
  }
  if (changes.description !== undefined) {
    body.body = { content: changes.description, contentType: "text" };
  }
  if (changes.location !== undefined) {
    body.location = { displayName: changes.location };
  }
  if (changes.availability !== undefined) {
    body.showAs = changes.availability;
  }
  if (changes.visibility !== undefined) {
    body.sensitivity = changes.visibility === "private" ? "private" : "normal";
  }
  if (changes.addMeeting === true && current?.isOnlineMeeting !== true) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = "teamsForBusiness";
  }
  if (changes.time) {
    const { time } = changes;
    const zone =
      time.kind === "all-day"
        ? (current?.originalStartTimeZone ?? "UTC")
        : time.timeZone;
    body.isAllDay = time.kind === "all-day";
    body.start = {
      dateTime:
        time.kind === "all-day"
          ? `${time.startDate}T00:00:00`
          : calendarInstantToWallTime(time.start, zone),
      timeZone: zone,
    };
    body.end = {
      dateTime:
        time.kind === "all-day"
          ? `${time.endDate}T00:00:00`
          : calendarInstantToWallTime(time.end, zone),
      timeZone: zone,
    };
  }
  if (changes.recurrence !== undefined) {
    if (current?.seriesMasterId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Open the whole series to change its recurrence.",
      });
    }
    const originalZone = resolveCalendarTimeZone(
      current?.originalStartTimeZone
    );
    if (!changes.time && current && !current.isAllDay && !originalZone) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Choose the event's time zone before changing its repeat rule.",
      });
    }
    let { time } = changes;
    if (!time && current) {
      time = current.isAllDay
        ? {
            endDate: current.end.dateTime.slice(0, 10),
            kind: "all-day",
            startDate: current.start.dateTime.slice(0, 10),
          }
        : {
            end: `${current.end.dateTime.replace(/Z$/u, "")}Z`,
            kind: "timed",
            start: `${current.start.dateTime.replace(/Z$/u, "")}Z`,
            timeZone: originalZone ?? "UTC",
          };
    }
    if (!time) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose a time for the repeating event.",
      });
    }
    const recurrence = toMicrosoftRecurrence(changes.recurrence, time);
    if (
      recurrence &&
      time.kind === "all-day" &&
      current?.originalStartTimeZone
    ) {
      recurrence.range.recurrenceTimeZone = current.originalStartTimeZone;
    }
    body.recurrence = recurrence;
  } else if (changes.time && current?.recurrence) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Include the repeat rule when changing the time of a whole series.",
    });
  }
  if (changes.reminders?.kind === "custom") {
    if (
      changes.reminders.items.length > 1 ||
      changes.reminders.items.some((item) => item.method !== "notification")
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This calendar supports one notification reminder per event.",
      });
    }
    body.isReminderOn = changes.reminders.items.length > 0;
    if (changes.reminders.items.length > 0) {
      body.reminderMinutesBeforeStart =
        changes.reminders.items[0].minutesBefore;
    }
  } else if (changes.reminders?.kind === "default" && current) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Choose a reminder time or turn reminders off for this calendar.",
    });
  }
  return body;
};

export const listMicrosoftCalendarsForUser = async (
  input: UserRequest & { connectionId: string }
): Promise<{ calendars: CalendarSummary[] }> =>
  await runAuthorizedConnector(
    { ...input, provider: "microsoft_calendar" },
    async (accessToken, signal) => {
      const calendars = await readPages({
        accessToken,
        path: "me/calendars?$top=250",
        schema: calendarSchema,
        signal,
      });
      return {
        calendars: calendars.map((calendar) =>
          toSummary(calendar, input.connectionId)
        ),
      };
    }
  );

export const listMicrosoftCalendarEventsForUser = async (
  input: z.infer<typeof calendarEventsInputSchema> & UserRequest
): Promise<{ events: CalendarEvent[] }> =>
  await withCalendar(input, false, async (context) => {
    const parameters = new URLSearchParams({
      $top: "250",
      endDateTime: input.end,
      startDateTime: input.start,
    });
    const events = await readPages({
      ...context,
      path: `me/calendars/${encodeURIComponent(context.calendarId)}/calendarView?${parameters}`,
      schema: eventSchema,
    });
    const results: CalendarEvent[] = [];
    for (const event of events) {
      if (event.isCancelled !== true) {
        const result = toEvent(
          context,
          event.isAllDay ? await readEvent(context, event.id) : event
        );
        if (
          !input.query ||
          `${result.title}\n${result.description}\n${result.location}`
            .toLowerCase()
            .includes(input.query.toLowerCase())
        ) {
          results.push(result);
        }
      }
    }
    return { events: results };
  });

export const getMicrosoftCalendarEventForUser = async (
  input: CalendarEventRef & UserRequest
): Promise<CalendarEvent> =>
  await withCalendar(input, false, async (context) =>
    toEvent(context, await readEvent(context, input.eventId))
  );

export const createMicrosoftCalendarEventForUser = async (
  input: z.infer<typeof calendarCreateInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    if (
      input.event.addMeeting &&
      context.calendar.allowedOnlineMeetingProviders?.includes(
        "teamsForBusiness"
      ) !== true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This calendar does not support adding a meeting link.",
      });
    }
    const body = eventChanges(input.event);
    const transactionId = createHash("sha256")
      .update(
        JSON.stringify([
          input.userId,
          input.connectionId,
          context.calendarId,
          input.operationId,
        ])
      )
      .digest("hex");
    const response = await requestMicrosoftGraph({
      ...context,
      body: { ...body, transactionId },
      method: "POST",
      path: `me/calendars/${encodeURIComponent(context.calendarId)}/events`,
      prefer,
    });
    const created = eventSchema.parse(
      JSON.parse(await readBoundedMicrosoftContent(response, 1024 * 1024))
    );
    const event = toEvent(
      context,
      created.isAllDay ? await readEvent(context, created.id) : created
    );
    return {
      action: "created",
      calendarId: context.calendarId,
      connectionId: input.connectionId,
      event,
      eventId: event.eventId,
      status: "success",
    };
  });

export const updateMicrosoftCalendarEventForUser = async (
  input: z.infer<typeof calendarUpdateInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    const current = await readEvent(context, input.eventId);
    if (current["@odata.etag"] !== input.version) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event changed since you opened it. Refresh your calendar before trying again.",
      });
    }
    if (!toEvent(context, current).permissions.edit) {
      throw new ORPCError("FORBIDDEN", {
        message: "Open this event in your calendar account to edit it.",
      });
    }
    if (
      input.changes.addMeeting === true &&
      context.calendar.allowedOnlineMeetingProviders?.includes(
        "teamsForBusiness"
      ) !== true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This calendar does not support adding a meeting link.",
      });
    }
    const response = await requestMicrosoftGraph({
      ...context,
      body: eventChanges(input.changes, current),
      method: "PATCH",
      path: `me/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      prefer,
      version: input.version,
    });
    const updated = eventSchema.parse(
      JSON.parse(await readBoundedMicrosoftContent(response, 1024 * 1024))
    );
    const event = toEvent(
      context,
      updated.isAllDay ? await readEvent(context, updated.id) : updated
    );
    return {
      action: "updated",
      calendarId: context.calendarId,
      connectionId: input.connectionId,
      event,
      eventId: event.eventId,
      status: "success",
    };
  });

export const deleteMicrosoftCalendarEventForUser = async (
  input: z.infer<typeof calendarDeleteInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    const current = await readEvent(context, input.eventId);
    if (current["@odata.etag"] !== input.version) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event changed since you opened it. Refresh your calendar before trying again.",
      });
    }
    if (!toEvent(context, current).permissions.delete) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "Open this event in your calendar account to delete it. Meetings with guests can send cancellation messages.",
      });
    }
    await requestMicrosoftGraph({
      ...context,
      method: "DELETE",
      path: `me/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      version: input.version,
    });
    return {
      action: "deleted",
      calendarId: context.calendarId,
      connectionId: input.connectionId,
      eventId: input.eventId,
      status: "success",
    };
  });

export const respondToMicrosoftCalendarEventForUser = async (
  input: z.infer<typeof calendarRespondInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    const current = await readEvent(context, input.eventId);
    if (current["@odata.etag"] !== input.version) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event changed since you opened it. Refresh your calendar before trying again.",
      });
    }
    if (!toEvent(context, current).permissions.respond) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "You can only respond to invitations addressed to this calendar account.",
      });
    }
    const action = {
      accepted: "accept",
      declined: "decline",
      tentative: "tentativelyAccept",
    }[input.response];
    await requestMicrosoftGraph({
      ...context,
      body: { sendResponse: true },
      method: "POST",
      path: `me/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(input.eventId)}/${action}`,
      version: input.version,
    });
    return {
      action: "responded",
      calendarId: context.calendarId,
      connectionId: input.connectionId,
      eventId: input.eventId,
      status: "success",
    };
  });

export const updateMicrosoftCalendarColorForUser = async (
  input: z.infer<typeof calendarUpdateColorInputSchema> & UserRequest
): Promise<CalendarSummary> =>
  await withCalendar(input, false, () => {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Open this calendar in your connected account to change its color.",
    });
  });
