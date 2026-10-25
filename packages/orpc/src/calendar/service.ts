import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarEventRef,
  CalendarMutationResult,
  CalendarRef,
  calendarCreateInputSchema,
  calendarDeleteInputSchema,
  calendarEventsInputSchema,
  calendarRespondInputSchema,
  calendarUpdateInputSchema,
} from "@quieter/calendar";
import { db } from "@quieter/database/client";
import { connectorCredential } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import type { GoogleCalendarEventDraft } from "../connectors/ical";
import {
  ConnectorHttpError,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  hasRequiredConnectorScopes,
  runAuthorizedConnector,
} from "../connectors/runtime";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  getGoogleCalendar,
  getGoogleEvent,
  googleEventChanges,
  importGoogleEvent,
  listGoogleCalendars,
  listGoogleEvents,
  patchGoogleEvent,
  toCalendarEvent,
  toCalendarSummary,
} from "./google";
import type { GoogleCalendar } from "./google";

type UserRequest = { signal?: AbortSignal; userId: string };
type CalendarRequest = CalendarRef & UserRequest;
type CalendarContext = {
  accessToken: string;
  calendar: GoogleCalendar;
  calendarId: string;
  connectionId: string;
  signal?: AbortSignal;
};

const readCalendarFailure = (error: unknown): never => {
  if (error instanceof ORPCError) {
    throw error;
  }
  if (error instanceof ConnectorHttpError) {
    if (error.status === 404 || error.status === 410) {
      throw new ORPCError("NOT_FOUND", {
        message:
          "This calendar or event is no longer available. Refresh your calendar.",
      });
    }
    if (error.status === 412 || error.status === 409) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event changed since you opened it. Refresh your calendar before trying again.",
      });
    }
    if (error.status === 401) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Reconnect your calendar account before trying again.",
      });
    }
    if (error.status === 429) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Your calendar is temporarily busy. Try again shortly.",
      });
    }
    if (error.status === 403) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have permission to perform this calendar action.",
      });
    }
    if (error.status === 400) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "These event details could not be saved. Check the time, guests, and recurrence and try again.",
      });
    }
  }
  throw error;
};

const getOwnedConnection = async (
  input: UserRequest & { connectionId: string }
) => {
  const [credential] = await db
    .select({
      accountEmail: connectorCredential.accountEmail,
      id: connectorCredential.id,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, GOOGLE_CALENDAR_CONNECTOR_PROVIDER),
        eq(connectorCredential.id, input.connectionId)
      )
    )
    .limit(1);
  if (credential === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "This calendar account is not connected.",
    });
  }
  return credential;
};

const withCalendar = async <T>(
  input: CalendarRequest,
  write: boolean,
  run: (context: CalendarContext) => Promise<T>
): Promise<T> => {
  const credential = await getOwnedConnection(input);
  const localWrite = write && serverEnv.QUIETER_DEPLOYMENT_ENV === "local";
  const allowed = new Set(
    (serverEnv.QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    localWrite &&
    (serverEnv.QUIETER_LOCAL_PROVIDER_MODE !== "write" ||
      !credential.accountEmail ||
      !allowed.has(credential.accountEmail.toLowerCase()))
  ) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Calendar write tests require write mode and an explicitly allowed connected account.",
    });
  }
  try {
    return await runAuthorizedConnector(
      { ...input, provider: GOOGLE_CALENDAR_CONNECTOR_PROVIDER },
      async (accessToken, signal) => {
        const calendar = await getGoogleCalendar({
          accessToken,
          calendarId: input.calendarId,
          signal,
        });
        if (
          write &&
          calendar.accessRole !== "owner" &&
          calendar.accessRole !== "writer" &&
          calendar.accessRole !== "writerWithoutPrivateAccess"
        ) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "This calendar is read only. Choose a calendar you can edit.",
          });
        }
        if (
          localWrite &&
          calendar.primary !== true &&
          !allowed.has(calendar.id.toLowerCase())
        ) {
          throw new ORPCError("FORBIDDEN", {
            message:
              "This calendar is not allowed for development write tests.",
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
  } catch (error) {
    return readCalendarFailure(error);
  }
};

export const listCalendarAccountsForUser = async (
  input: UserRequest
): Promise<{ accounts: CalendarAccount[]; isConfigured: boolean }> => {
  const credentials = await db
    .select({
      accountEmail: connectorCredential.accountEmail,
      displayName: connectorCredential.displayName,
      id: connectorCredential.id,
      scopes: connectorCredential.scopes,
      status: connectorCredential.status,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, GOOGLE_CALENDAR_CONNECTOR_PROVIDER)
      )
    );
  return {
    accounts: credentials.map((credential) => ({
      email: credential.accountEmail,
      id: credential.id,
      name:
        credential.displayName ?? credential.accountEmail ?? "Calendar account",
      status:
        credential.status === "connected" &&
        hasRequiredConnectorScopes(
          GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
          credential.scopes ?? ""
        )
          ? "connected"
          : "needs-reconnect",
    })),
    isConfigured: Boolean(
      serverEnv.BETTER_AUTH_URL &&
      serverEnv.GOOGLE_CALENDAR_CLIENT_ID &&
      serverEnv.GOOGLE_CALENDAR_CLIENT_SECRET &&
      serverEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY
    ),
  };
};

export const listCalendarsForUser = async (
  input: UserRequest & { connectionId: string }
) => {
  await getOwnedConnection(input);
  try {
    return await runAuthorizedConnector(
      { ...input, provider: GOOGLE_CALENDAR_CONNECTOR_PROVIDER },
      async (accessToken, signal) => {
        const calendars = await listGoogleCalendars({ accessToken, signal });
        return {
          calendars: calendars.map((calendar) =>
            toCalendarSummary({ calendar, connectionId: input.connectionId })
          ),
        };
      }
    );
  } catch (error) {
    return readCalendarFailure(error);
  }
};

export const listCalendarEventsForUser = async (
  input: z.infer<typeof calendarEventsInputSchema> & UserRequest
): Promise<{ events: CalendarEvent[] }> =>
  await withCalendar(input, false, async (context) => {
    const events = await listGoogleEvents({
      ...context,
      end: input.end,
      query: input.query,
      start: input.start,
      timeZone: input.timeZone,
    });
    return {
      events: events.map((event) => toCalendarEvent({ ...context, event })),
    };
  });

export const getCalendarEventForUser = async (
  input: CalendarEventRef & UserRequest
): Promise<CalendarEvent> =>
  await withCalendar(input, false, async (context) =>
    toCalendarEvent({
      ...context,
      event: await getGoogleEvent({ ...context, eventId: input.eventId }),
    })
  );

export const createCalendarEventForUser = async (
  input: z.infer<typeof calendarCreateInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    if (
      input.event.addMeeting &&
      context.calendar.conferenceProperties?.allowedConferenceSolutionTypes?.includes(
        "hangoutsMeet"
      ) !== true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This calendar does not support adding a meeting link.",
      });
    }
    const event = await createGoogleEvent({
      ...context,
      event: input.event,
      operationId: input.operationId,
      userId: input.userId,
    });
    return {
      action: "created",
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      event: toCalendarEvent({ ...context, event }),
      eventId: event.id,
      status: "success",
    };
  });

export const updateCalendarEventForUser = async (
  input: z.infer<typeof calendarUpdateInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    const current = await getGoogleEvent({
      ...context,
      eventId: input.eventId,
    });
    if (current.etag !== input.version) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event changed since you opened it. Refresh your calendar before trying again.",
      });
    }
    if (!toCalendarEvent({ ...context, event: current }).permissions.edit) {
      throw new ORPCError("FORBIDDEN", {
        message: "This event cannot be edited here.",
      });
    }
    if (current.recurringEventId && input.changes.recurrence !== undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Open the whole series to change its recurrence.",
      });
    }
    if (current.recurringEventId && input.changes.visibility !== undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Open the whole series to change its visibility.",
      });
    }
    if (
      input.changes.attendees !== undefined &&
      current.attendeesOmitted === true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "The complete guest list could not be loaded. Refresh before changing guests.",
      });
    }
    if (
      input.changes.addMeeting === true &&
      context.calendar.conferenceProperties?.allowedConferenceSolutionTypes?.includes(
        "hangoutsMeet"
      ) !== true
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "This calendar does not support adding a meeting link.",
      });
    }
    const body = googleEventChanges({
      changes: input.changes,
      current,
      meetingRequestId: createHash("sha256")
        .update(
          JSON.stringify([
            input.connectionId,
            input.calendarId,
            current.id,
            input.version,
          ])
        )
        .digest("hex"),
    });
    const event = await patchGoogleEvent({
      ...context,
      body,
      eventId: current.id,
      version: input.version,
    });
    return {
      action: "updated",
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      event: toCalendarEvent({ ...context, event }),
      eventId: event.id,
      status: "success",
    };
  });

export const deleteCalendarEventForUser = async (
  input: z.infer<typeof calendarDeleteInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    const current = await getGoogleEvent({
      ...context,
      eventId: input.eventId,
    });
    if (current.etag !== input.version) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event changed since you opened it. Refresh your calendar before trying again.",
      });
    }
    if (!toCalendarEvent({ ...context, event: current }).permissions.delete) {
      throw new ORPCError("FORBIDDEN", {
        message: "This event cannot be deleted here.",
      });
    }
    await deleteGoogleEvent({
      ...context,
      eventId: current.id,
      version: input.version,
    });
    return {
      action: "deleted",
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      eventId: current.id,
      status: "success",
    };
  });

export const respondToCalendarEventForUser = async (
  input: z.infer<typeof calendarRespondInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, true, async (context) => {
    const current = await getGoogleEvent({
      ...context,
      eventId: input.eventId,
    });
    if (current.etag !== input.version) {
      throw new ORPCError("CONFLICT", {
        message:
          "This event changed since you opened it. Refresh your calendar before trying again.",
      });
    }
    const self = current.attendees?.find(
      (attendee) => attendee.self === true && attendee.organizer !== true
    );
    if (
      !self ||
      !toCalendarEvent({ ...context, event: current }).permissions.respond
    ) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "You can only respond to invitations addressed to this calendar account.",
      });
    }
    const event = await patchGoogleEvent({
      ...context,
      body: {
        attendees: [{ ...self, responseStatus: input.response }],
        attendeesOmitted: true,
      },
      eventId: current.id,
      version: input.version,
    });
    return {
      action: "responded",
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      event: toCalendarEvent({ ...context, event }),
      eventId: event.id,
      status: "success",
    };
  });

export const resolveCalendarImportTargetForUser = async (
  input: UserRequest & { calendarId?: string; connectionId?: string }
): Promise<CalendarRef> => {
  if (input.connectionId) {
    await getOwnedConnection({ ...input, connectionId: input.connectionId });
    return {
      calendarId: input.calendarId ?? "primary",
      connectionId: input.connectionId,
    };
  }
  const { accounts } = await listCalendarAccountsForUser(input);
  const [account] = accounts;
  if (accounts.length !== 1 || account === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        accounts.length === 0
          ? "Connect a calendar account before adding this invitation."
          : "Choose a calendar account before adding this invitation.",
    });
  }
  return {
    calendarId: input.calendarId ?? "primary",
    connectionId: account.id,
  };
};

export const importCalendarInvitationForUser = async (
  input: CalendarRequest & {
    event: GoogleCalendarEventDraft;
    fallbackUid: string;
  }
) =>
  await withCalendar(input, true, async (context) => {
    const event = await importGoogleEvent({
      ...context,
      event: {
        ...input.event,
        iCalUID: input.event.iCalUID ?? input.fallbackUid,
      },
    });
    return {
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      htmlLink: event.htmlLink,
      id: event.id,
      status: "success" as const,
      summary: event.summary ?? input.event.summary,
    };
  });
