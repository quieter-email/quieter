import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type {
  CalendarEvent,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarEventTime,
  CalendarSummary,
} from "@quieter/calendar";
import {
  calendarColorSchema,
  calendarEventTimeSchema,
  calendarTimeZoneSchema,
} from "@quieter/calendar";
import { z } from "zod";

import { ConnectorHttpError } from "../connectors/runtime";

const API_URL = "https://www.googleapis.com/calendar/v3";
const externalUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const attendeeSchema = z.object({
  additionalGuests: z.number().optional(),
  comment: z.string().optional(),
  displayName: z.string().optional(),
  email: z.string().optional(),
  id: z.string().optional(),
  optional: z.boolean().optional(),
  organizer: z.boolean().optional(),
  resource: z.boolean().optional(),
  responseStatus: z
    .enum(["needsAction", "accepted", "tentative", "declined"])
    .optional(),
  self: z.boolean().optional(),
});
const dateSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});
const remindersSchema = z.object({
  overrides: z
    .array(
      z.object({
        method: z.enum(["email", "popup"]),
        minutes: z.number().int(),
      })
    )
    .optional(),
  useDefault: z.boolean().optional(),
});
const eventSchema = z.object({
  attendees: z.array(attendeeSchema).optional(),
  attendeesOmitted: z.boolean().optional(),
  colorId: z.string().optional(),
  conferenceData: z
    .object({
      createRequest: z
        .object({
          status: z.object({ statusCode: z.string() }).optional(),
        })
        .optional(),
      entryPoints: z
        .array(z.object({ entryPointType: z.string(), uri: z.string() }))
        .optional(),
    })
    .optional(),
  description: z.string().optional(),
  end: dateSchema.optional(),
  etag: z.string().min(1),
  eventType: z.string().optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
  guestsCanModify: z.boolean().optional(),
  hangoutLink: z.string().optional(),
  htmlLink: z.string().optional(),
  iCalUID: z.string().optional(),
  id: z.string().min(1),
  location: z.string().optional(),
  locked: z.boolean().optional(),
  organizer: z
    .object({
      displayName: z.string().optional(),
      email: z.string().optional(),
      self: z.boolean().optional(),
    })
    .optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),
  reminders: remindersSchema.optional(),
  start: dateSchema.optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  summary: z.string().optional(),
  transparency: z.string().optional(),
  visibility: z.string().optional(),
});
const calendarSchema = z.object({
  accessRole: z.enum([
    "freeBusyReader",
    "reader",
    "writerWithoutPrivateAccess",
    "writer",
    "owner",
  ]),
  backgroundColor: calendarColorSchema.optional(),
  colorId: z.string().optional(),
  conferenceProperties: z
    .object({ allowedConferenceSolutionTypes: z.array(z.string()).optional() })
    .optional(),
  deleted: z.boolean().optional(),
  id: z.string().min(1),
  primary: z.boolean().optional(),
  selected: z.boolean().optional(),
  summary: z.string().optional(),
  summaryOverride: z.string().optional(),
  timeZone: z.string().optional(),
});
export type GoogleCalendar = z.infer<typeof calendarSchema>;
export type GoogleEvent = z.infer<typeof eventSchema>;
const colorDefinitionSchema = z.object({
  background: calendarColorSchema,
  foreground: calendarColorSchema,
});
const colorsSchema = z.object({
  calendar: z.record(z.string(), colorDefinitionSchema),
  event: z.record(z.string(), colorDefinitionSchema),
});
export type GoogleColors = z.infer<typeof colorsSchema>;
let cachedColors: { expiresAt: number; value: GoogleColors } | undefined;
type GoogleAuth = { accessToken: string; signal?: AbortSignal };
type GoogleTarget = GoogleAuth & { calendarId: string };
const accessRoles = {
  freeBusyReader: "busy",
  owner: "owner",
  reader: "read",
  writer: "write",
  writerWithoutPrivateAccess: "write",
} satisfies Record<GoogleCalendar["accessRole"], CalendarSummary["access"]>;

const errorResponseSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string() })).optional(),
  }),
});

const requestGoogle = async (
  input: GoogleAuth & {
    body?: unknown;
    method?: "POST" | "PATCH" | "DELETE";
    path: string;
    version?: string;
  }
) => {
  const response = await fetch(`${API_URL}${input.path}`, {
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      ...(input.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(input.version === undefined ? {} : { "If-Match": input.version }),
    },
    method: input.method,
    signal:
      input.signal === undefined
        ? AbortSignal.timeout(20_000)
        : AbortSignal.any([input.signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) {
    let { status } = response;
    if (status === 403) {
      const details = errorResponseSchema.safeParse(
        await response.json().catch(() => null)
      );
      if (
        details.success &&
        details.data.error.errors?.some(({ reason }) =>
          [
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "quotaExceeded",
            "dailyLimitExceeded",
          ].includes(reason)
        ) === true
      ) {
        status = 429;
      }
    }
    throw new ConnectorHttpError(
      "The calendar request could not be completed.",
      status
    );
  }
  return response;
};

export const listGoogleCalendars = async (
  input: GoogleAuth
): Promise<GoogleCalendar[]> => {
  const calendars: GoogleCalendar[] = [];
  const seenPages = new Set<string>();
  let pageToken: string | undefined;
  do {
    const parameters = new URLSearchParams({
      maxResults: "250",
      showHidden: "true",
    });
    if (pageToken) {
      parameters.set("pageToken", pageToken);
    }
    const response = await requestGoogle({
      ...input,
      path: `/users/me/calendarList?${parameters}`,
    });
    const page = z
      .object({
        items: z.array(calendarSchema).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(await response.json());
    calendars.push(
      ...page.items.filter((calendar) => calendar.deleted !== true)
    );
    pageToken = page.nextPageToken;
    if (pageToken && seenPages.has(pageToken)) {
      throw new Error("Calendar pagination did not advance.");
    }
    if (pageToken) {
      seenPages.add(pageToken);
    }
  } while (pageToken);
  return calendars;
};

export const getGoogleCalendar = async (
  input: GoogleTarget
): Promise<GoogleCalendar> => {
  const response = await requestGoogle({
    ...input,
    path: `/users/me/calendarList/${encodeURIComponent(input.calendarId)}`,
  });
  return calendarSchema.parse(await response.json());
};

export const getGoogleColors = async (
  input: GoogleAuth
): Promise<GoogleColors> => {
  input.signal?.throwIfAborted();
  if (cachedColors && cachedColors.expiresAt > Date.now()) {
    return cachedColors.value;
  }
  const response = await requestGoogle({ ...input, path: "/colors" });
  const value = colorsSchema.parse(await response.json());
  cachedColors = { expiresAt: Date.now() + 24 * 60 * 60 * 1000, value };
  return value;
};

export const patchGoogleCalendarColor = async (
  input: GoogleTarget & { color: string }
): Promise<GoogleCalendar> => {
  const response = await requestGoogle({
    ...input,
    body: { backgroundColor: input.color },
    method: "PATCH",
    path: `/users/me/calendarList/${encodeURIComponent(input.calendarId)}?colorRgbFormat=true`,
  });
  return calendarSchema.parse(await response.json());
};

export const toCalendarSummary = (input: {
  calendar: GoogleCalendar;
  colors?: GoogleColors;
  connectionId: string;
}): CalendarSummary => ({
  access: accessRoles[input.calendar.accessRole],
  calendarId: input.calendar.id,
  color:
    input.calendar.backgroundColor ??
    (input.calendar.colorId
      ? input.colors?.calendar[input.calendar.colorId]?.background
      : undefined),
  connectionId: input.connectionId,
  name: input.calendar.summaryOverride ?? input.calendar.summary ?? "Calendar",
  primary: input.calendar.primary ?? false,
  selected: input.calendar.selected ?? true,
  supportsMeetings:
    input.calendar.conferenceProperties?.allowedConferenceSolutionTypes?.includes(
      "hangoutsMeet"
    ) ?? false,
  timeZone: calendarTimeZoneSchema.parse(input.calendar.timeZone ?? "UTC"),
});

export const listGoogleEvents = async (
  input: GoogleTarget & {
    end?: string;
    iCalUID?: string;
    query?: string;
    start?: string;
    timeZone?: string;
  }
): Promise<GoogleEvent[]> => {
  const events: GoogleEvent[] = [];
  const seenPages = new Set<string>();
  let pageToken: string | undefined;
  do {
    const parameters = new URLSearchParams({
      maxResults: "2500",
      showDeleted: "false",
      singleEvents: input.iCalUID ? "false" : "true",
    });
    if (input.start) {
      parameters.set("timeMin", input.start);
      parameters.set("orderBy", "startTime");
    }
    if (input.end) {
      parameters.set("timeMax", input.end);
    }
    if (input.timeZone) {
      parameters.set("timeZone", input.timeZone);
    }
    if (input.query) {
      parameters.set("q", input.query);
    }
    if (input.iCalUID) {
      parameters.set("iCalUID", input.iCalUID);
    }
    if (pageToken) {
      parameters.set("pageToken", pageToken);
    }
    const response = await requestGoogle({
      ...input,
      path: `/calendars/${encodeURIComponent(input.calendarId)}/events?${parameters}`,
    });
    const page = z
      .object({
        items: z.array(eventSchema).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(await response.json());
    events.push(...page.items.filter((event) => event.status !== "cancelled"));
    pageToken = page.nextPageToken;
    if (pageToken && seenPages.has(pageToken)) {
      throw new Error("Calendar pagination did not advance.");
    }
    if (pageToken) {
      seenPages.add(pageToken);
    }
  } while (pageToken);
  return events;
};

export const getGoogleEvent = async (
  input: GoogleTarget & { eventId: string }
): Promise<GoogleEvent> => {
  const response = await requestGoogle({
    ...input,
    path: `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
  });
  const event = eventSchema.parse(await response.json());
  if (event.status === "cancelled") {
    throw new ORPCError("NOT_FOUND", {
      message: "This event is no longer available. Refresh your calendar.",
    });
  }
  return event;
};

export const toCalendarEvent = (input: {
  calendar: GoogleCalendar;
  colors?: GoogleColors;
  connectionId: string;
  event: GoogleEvent;
}): CalendarEvent => {
  const { calendar, event } = input;
  const colorOverride = event.colorId
    ? input.colors?.event[event.colorId]?.background
    : undefined;
  let time: CalendarEventTime;
  if (event.start?.date && event.end?.date) {
    time = calendarEventTimeSchema.parse({
      endDate: event.end.date,
      kind: "all-day",
      startDate: event.start.date,
    });
  } else {
    time = calendarEventTimeSchema.parse({
      end: event.end?.dateTime,
      kind: "timed",
      start: event.start?.dateTime,
      timeZone: event.start?.timeZone ?? calendar.timeZone ?? "UTC",
    });
  }
  const writable =
    (calendar.accessRole === "owner" ||
      calendar.accessRole === "writer" ||
      (calendar.accessRole === "writerWithoutPrivateAccess" &&
        event.visibility !== "private" &&
        event.visibility !== "confidential")) &&
    event.locked !== true &&
    (!event.eventType || event.eventType === "default") &&
    event.status !== "cancelled";
  const canEdit =
    writable &&
    (event.organizer?.self === true ||
      event.guestsCanModify === true ||
      !event.organizer);
  const meetingCandidate =
    event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === "video"
    )?.uri ?? event.hangoutLink;
  const meetingUrl = externalUrlSchema.safeParse(meetingCandidate);
  const webUrl = externalUrlSchema.safeParse(event.htmlLink);
  let visibility: CalendarEvent["visibility"] = "default";
  if (event.visibility === "private" || event.visibility === "confidential") {
    visibility = "private";
  } else if (event.visibility === "public") {
    visibility = "public";
  }
  return {
    attendees: (event.attendees ?? []).flatMap((attendee) =>
      attendee.email
        ? [
            {
              email: attendee.email,
              name: attendee.displayName,
              optional: attendee.optional ?? false,
              organizer: attendee.organizer ?? false,
              response:
                attendee.responseStatus === "needsAction" ||
                !attendee.responseStatus
                  ? ("needs-action" as const)
                  : attendee.responseStatus,
              self: attendee.self ?? false,
            },
          ]
        : []
    ),
    availability: event.transparency === "transparent" ? "free" : "busy",
    calendarId: calendar.id,
    color:
      colorOverride ??
      calendar.backgroundColor ??
      (calendar.colorId
        ? input.colors?.calendar[calendar.colorId]?.background
        : undefined),
    ...(colorOverride ? { colorOverride } : {}),
    connectionId: input.connectionId,
    description: event.description ?? "",
    eventId: event.id,
    location: event.location ?? "",
    meetingPending:
      event.conferenceData?.createRequest?.status?.statusCode === "pending",
    ...(meetingUrl.success ? { meetingUrl: meetingUrl.data } : {}),
    ...(event.organizer
      ? {
          organizer: {
            email: event.organizer.email,
            name: event.organizer.displayName,
            self: event.organizer.self ?? false,
          },
        }
      : {}),
    permissions: {
      delete: writable,
      edit: canEdit,
      respond:
        writable &&
        (event.attendees?.some(
          (attendee) => attendee.self === true && attendee.organizer !== true
        ) ??
          false),
    },
    recurrence: event.recurrence ?? [],
    ...(event.recurringEventId
      ? { recurringEventId: event.recurringEventId }
      : {}),
    reminders:
      event.reminders?.useDefault === false
        ? {
            items: (event.reminders.overrides ?? []).map((reminder) => ({
              method: reminder.method === "popup" ? "notification" : "email",
              minutesBefore: reminder.minutes,
            })),
            kind: "custom",
          }
        : { kind: "default" },
    status: event.status ?? "confirmed",
    time,
    title:
      event.summary ??
      (event.visibility === "private" ||
      calendar.accessRole === "freeBusyReader"
        ? "Busy"
        : "Untitled event"),
    version: event.etag,
    visibility,
    ...(webUrl.success ? { webUrl: webUrl.data } : {}),
  };
};

export const googleEventChanges = (input: {
  changes: CalendarEventPatch;
  colors?: GoogleColors;
  current?: GoogleEvent;
  meetingRequestId: string;
}) => {
  const { changes, current } = input;
  const { time } = changes;
  let colorId: string | null | undefined;
  if (changes.color === null) {
    colorId = null;
  } else if (changes.color !== undefined) {
    const requestedColor = changes.color.toLowerCase();
    colorId = Object.entries(input.colors?.event ?? {}).find(
      ([, color]) => color.background.toLowerCase() === requestedColor
    )?.[0];
    if (colorId === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose one of the available event colors.",
      });
    }
  }
  return {
    ...(colorId === undefined ? {} : { colorId }),
    ...(changes.addMeeting === true &&
    !current?.hangoutLink &&
    !current?.conferenceData
      ? {
          conferenceData: {
            createRequest: {
              conferenceSolutionKey: { type: "hangoutsMeet" },
              requestId: input.meetingRequestId,
            },
          },
        }
      : {}),
    ...(changes.addMeeting === false && current?.conferenceData
      ? { conferenceData: null }
      : {}),
    ...(changes.attendees === undefined
      ? {}
      : {
          attendees: changes.attendees.map((attendee) => {
            const existing = current?.attendees?.find(
              (candidate) =>
                candidate.email?.toLowerCase() === attendee.email.toLowerCase()
            );
            return {
              ...existing,
              displayName: attendee.name,
              email: attendee.email,
              optional: attendee.optional,
            };
          }),
        }),
    ...(changes.availability === undefined
      ? {}
      : {
          transparency:
            changes.availability === "free" ? "transparent" : "opaque",
        }),
    ...(changes.description === undefined
      ? {}
      : { description: changes.description }),
    ...(changes.location === undefined ? {} : { location: changes.location }),
    ...(changes.recurrence === undefined
      ? {}
      : {
          recurrence:
            changes.recurrence.length === 0 ? null : changes.recurrence,
        }),
    ...(changes.reminders === undefined
      ? {}
      : {
          reminders:
            changes.reminders.kind === "default"
              ? { useDefault: true }
              : {
                  overrides: changes.reminders.items.map((reminder) => ({
                    method:
                      reminder.method === "notification" ? "popup" : "email",
                    minutes: reminder.minutesBefore,
                  })),
                  useDefault: false,
                },
        }),
    ...(time
      ? {
          end:
            time.kind === "all-day"
              ? {
                  date: time.endDate,
                  ...(current ? { dateTime: null, timeZone: null } : {}),
                }
              : {
                  ...(current ? { date: null } : {}),
                  dateTime: time.end,
                  timeZone: time.timeZone,
                },
          start:
            time.kind === "all-day"
              ? {
                  date: time.startDate,
                  ...(current ? { dateTime: null, timeZone: null } : {}),
                }
              : {
                  ...(current ? { date: null } : {}),
                  dateTime: time.start,
                  timeZone: time.timeZone,
                },
        }
      : {}),
    ...(changes.title === undefined ? {} : { summary: changes.title }),
    ...(changes.visibility === undefined
      ? {}
      : { visibility: changes.visibility }),
  };
};

export const createGoogleEvent = async (
  input: GoogleTarget & {
    colors?: GoogleColors;
    event: CalendarEventDraft;
    operationId: string;
    userId: string;
    connectionId: string;
  }
): Promise<GoogleEvent> => {
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        input.userId,
        input.connectionId,
        input.calendarId,
        input.operationId,
      ])
    )
    .digest("hex");
  const draft = googleEventChanges({
    changes: input.event,
    colors: input.colors,
    meetingRequestId: id,
  });
  const digest = createHash("sha256")
    .update(JSON.stringify(draft))
    .digest("hex");
  try {
    const response = await requestGoogle({
      ...input,
      body: {
        ...draft,
        extendedProperties: { private: { quieterDraft: digest } },
        id,
      },
      method: "POST",
      path: `/calendars/${encodeURIComponent(input.calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`,
    });
    return eventSchema.parse(await response.json());
  } catch (error) {
    if (
      error instanceof ConnectorHttpError &&
      error.status !== 409 &&
      error.status < 500
    ) {
      throw error;
    }
    let existing: GoogleEvent;
    try {
      existing = await getGoogleEvent({ ...input, eventId: id });
    } catch {
      throw error;
    }
    if (existing.extendedProperties?.private?.quieterDraft !== digest) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event was already submitted with different details. Refresh and try again.",
      });
    }
    return existing;
  }
};

export const patchGoogleEvent = async (
  input: GoogleTarget & {
    body: unknown;
    eventId: string;
    sendUpdates?: "all" | "none";
    version: string;
  }
): Promise<GoogleEvent> => {
  const response = await requestGoogle({
    ...input,
    method: "PATCH",
    path: `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?conferenceDataVersion=1&sendUpdates=${input.sendUpdates ?? "none"}`,
  });
  return eventSchema.parse(await response.json());
};

export const deleteGoogleEvent = async (
  input: GoogleTarget & { eventId: string; version: string }
) => {
  await requestGoogle({
    ...input,
    method: "DELETE",
    path: `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=none`,
  });
};

export const importGoogleEvent = async (
  input: GoogleTarget & { event: { iCalUID: string; [key: string]: unknown } }
): Promise<GoogleEvent> => {
  const findExisting = async () => {
    const events = await listGoogleEvents({
      ...input,
      iCalUID: input.event.iCalUID,
    });
    return events.find((event) => !event.recurringEventId);
  };
  const existing = await findExisting();
  if (existing) {
    return existing;
  }
  try {
    const response = await requestGoogle({
      ...input,
      body: input.event,
      method: "POST",
      path: `/calendars/${encodeURIComponent(input.calendarId)}/events/import`,
    });
    return eventSchema.parse(await response.json());
  } catch (error) {
    if (
      error instanceof ConnectorHttpError &&
      error.status !== 409 &&
      error.status !== 400 &&
      error.status < 500
    ) {
      throw error;
    }
    const imported = await findExisting();
    if (imported) {
      return imported;
    }
    throw error;
  }
};
