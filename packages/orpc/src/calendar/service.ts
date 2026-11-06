import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarEventRef,
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
import { db } from "@quieter/database/client";
import {
  connectorCredential,
  gmailCredential,
  mailbox,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import type { GoogleCalendarEventDraft } from "../connectors/ical";
import {
  ConnectorHttpError,
  hasRequiredConnectorScopes,
} from "../connectors/runtime";
import {
  CALENDAR_SCOPES,
  runAuthorizedGmailMailbox,
} from "../gmail-mailbox-access";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  getGoogleCalendar,
  getGoogleColors,
  getGoogleEvent,
  googleEventChanges,
  importGoogleEvent,
  listGoogleCalendars,
  listGoogleEvents,
  patchGoogleCalendarColor,
  patchGoogleEvent,
  toCalendarEvent,
  toCalendarSummary,
} from "./google";
import type { GoogleCalendar, GoogleEvent } from "./google";
import {
  createMicrosoftCalendarEventForUser,
  deleteMicrosoftCalendarEventForUser,
  getMicrosoftCalendarEventForUser,
  listMicrosoftCalendarEventsForUser,
  listMicrosoftCalendarsForUser,
  respondToMicrosoftCalendarEventForUser,
  updateMicrosoftCalendarColorForUser,
  updateMicrosoftCalendarEventForUser,
} from "./microsoft";

type UserRequest = {
  retryUnauthorized?: boolean;
  signal?: AbortSignal;
  userId: string;
};
type CalendarRequest = CalendarRef & UserRequest;
type CalendarContext = {
  accessToken: string;
  calendar: GoogleCalendar;
  calendarId: string;
  connectionId: string;
  signal?: AbortSignal;
};

const readCalendarEvent = async (
  context: CalendarContext,
  event: GoogleEvent
): Promise<CalendarEvent> => {
  const colors =
    event.colorId ||
    (!context.calendar.backgroundColor && context.calendar.colorId)
      ? await getGoogleColors(context)
      : undefined;
  return toCalendarEvent({ ...context, colors, event });
};

const readCalendarFailure = (error: unknown): never => {
  if (error instanceof ORPCError) {
    if (error.code === "MAILBOX_SCOPE_REPAIR_REQUIRED") {
      throw new ORPCError("UNAUTHORIZED", {
        cause: error,
        message: "Reconnect this mailbox to use its calendars.",
      });
    }
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

export const listCalendarAccountsForUser = async (
  input: UserRequest
): Promise<{
  accounts: CalendarAccount[];
  googleConfigured: boolean;
  isConfigured: boolean;
  microsoftConfigured: boolean;
}> => {
  input.signal?.throwIfAborted();
  const [mailboxes, legacyAccounts, microsoftAccounts] = await Promise.all([
    db
      .select({
        displayName: mailbox.displayName,
        emailAddress: mailbox.emailAddress,
        googleSubject: gmailCredential.googleSubject,
        id: mailbox.id,
        scopes: gmailCredential.scopes,
        status: mailbox.status,
      })
      .from(mailbox)
      .leftJoin(gmailCredential, eq(gmailCredential.mailboxId, mailbox.id))
      .where(
        and(
          eq(mailbox.ownerUserId, input.userId),
          eq(mailbox.provider, "gmail")
        )
      ),
    db
      .select({
        accountEmail: connectorCredential.accountEmail,
        displayName: connectorCredential.displayName,
        id: connectorCredential.id,
        providerAccountId: connectorCredential.providerAccountId,
      })
      .from(connectorCredential)
      .where(
        and(
          eq(connectorCredential.userId, input.userId),
          eq(connectorCredential.provider, "google_calendar")
        )
      ),
    db
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
          eq(connectorCredential.provider, "microsoft_calendar")
        )
      ),
  ]);
  const legacyBySubject = new Map(
    legacyAccounts.map((account) => [account.providerAccountId, account])
  );
  const matchedLegacyIds = new Set<string>();
  const accounts: CalendarAccount[] = mailboxes.map((record) => {
    const legacy = record.googleSubject
      ? legacyBySubject.get(record.googleSubject)
      : undefined;
    if (legacy) {
      matchedLegacyIds.add(legacy.id);
    }
    const grantedScopes = new Set((record.scopes ?? "").split(/\s+/u));
    let status: CalendarAccount["status"] = CALENDAR_SCOPES.every((scope) =>
      grantedScopes.has(scope)
    )
      ? "connected"
      : "needs-permission";
    if (record.status !== "connected" || record.googleSubject === null) {
      status = "needs-reconnect";
    }
    return {
      email: record.emailAddress,
      id: legacy?.id ?? record.id,
      mailboxId: record.id,
      name: record.displayName ?? record.emailAddress,
      provider: "google_calendar",
      status,
    };
  });
  for (const legacy of legacyAccounts) {
    if (!matchedLegacyIds.has(legacy.id)) {
      accounts.push({
        email: legacy.accountEmail,
        id: legacy.id,
        mailboxId: null,
        name: legacy.displayName ?? legacy.accountEmail ?? "Calendar account",
        provider: "google_calendar",
        status: "needs-mailbox",
      });
    }
  }
  for (const account of microsoftAccounts) {
    accounts.push({
      email: account.accountEmail,
      id: account.id,
      mailboxId: null,
      name: account.displayName ?? account.accountEmail ?? "Calendar account",
      provider: "microsoft_calendar",
      status:
        account.status === "connected" &&
        hasRequiredConnectorScopes("microsoft_calendar", account.scopes ?? "")
          ? "connected"
          : "needs-reconnect",
    });
  }
  const googleConfigured = Boolean(
    serverEnv.BETTER_AUTH_URL &&
    serverEnv.GOOGLE_GMAIL_CLIENT_ID &&
    serverEnv.GOOGLE_GMAIL_CLIENT_SECRET &&
    serverEnv.GMAIL_TOKEN_ENCRYPTION_KEY
  );
  const microsoftConfigured = Boolean(
    serverEnv.BETTER_AUTH_URL &&
    serverEnv.MICROSOFT_CLIENT_ID &&
    serverEnv.MICROSOFT_CLIENT_SECRET &&
    serverEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY
  );
  return {
    accounts,
    googleConfigured,
    isConfigured: googleConfigured || microsoftConfigured,
    microsoftConfigured,
  };
};

export const getCalendarAccountForUser = async (
  input: UserRequest & { connectionId: string }
): Promise<CalendarAccount> => {
  const { accounts } = await listCalendarAccountsForUser(input);
  const account =
    accounts.find((candidate) => candidate.mailboxId === input.connectionId) ??
    accounts.find((candidate) => candidate.id === input.connectionId);
  if (account === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "This calendar account is not connected.",
    });
  }
  return { ...account, id: input.connectionId };
};

const getAuthorizedCalendarAccount = async (
  input: UserRequest & { connectionId: string }
) => {
  const account = await getCalendarAccountForUser(input);
  if (account.provider === "microsoft_calendar") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Open this invitation in your calendar account to import it.",
    });
  }
  if (account.status === "needs-mailbox") {
    throw new ORPCError("FORBIDDEN", {
      message: "Connect this account as a Gmail mailbox to use its calendar.",
    });
  }
  if (account.status === "needs-permission") {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Enable calendar access for this Gmail mailbox before trying again.",
    });
  }
  if (account.status === "needs-reconnect") {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Reconnect this Gmail mailbox before trying again.",
    });
  }
  return account;
};

const withCalendar = async <T>(
  input: CalendarRequest,
  access: "read" | "event-write" | "preference-write",
  run: (context: CalendarContext) => Promise<T>
): Promise<T> => {
  const account = await getAuthorizedCalendarAccount(input);
  const localWrite =
    access !== "read" && serverEnv.QUIETER_DEPLOYMENT_ENV === "local";
  const allowed = new Set(
    (serverEnv.QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    localWrite &&
    (serverEnv.QUIETER_LOCAL_PROVIDER_MODE !== "write" ||
      !account.email ||
      !allowed.has(account.email.toLowerCase()))
  ) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Calendar write tests require write mode and an explicitly allowed connected account.",
    });
  }
  try {
    return await runAuthorizedGmailMailbox(
      {
        isUnauthorized: (error) =>
          error instanceof ConnectorHttpError && error.status === 401,
        mailboxId: account.mailboxId,
        retryUnauthorized: input.retryUnauthorized,
        userId: input.userId,
      },
      async (accessToken) => {
        const { signal } = input;
        signal?.throwIfAborted();
        const calendar = await getGoogleCalendar({
          accessToken,
          calendarId: input.calendarId,
          signal,
        });
        if (
          access === "event-write" &&
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

const listCalendarsForUserGoogle = async (
  input: UserRequest & { connectionId: string }
) => {
  const account = await getAuthorizedCalendarAccount(input);
  try {
    return await runAuthorizedGmailMailbox(
      {
        isUnauthorized: (error) =>
          error instanceof ConnectorHttpError && error.status === 401,
        mailboxId: account.mailboxId,
        retryUnauthorized: input.retryUnauthorized,
        userId: input.userId,
      },
      async (accessToken) => {
        const { signal } = input;
        signal?.throwIfAborted();
        const calendars = await listGoogleCalendars({ accessToken, signal });
        const colors = calendars.some(
          (calendar) =>
            !calendar.backgroundColor && calendar.colorId !== undefined
        )
          ? await getGoogleColors({ accessToken, signal })
          : undefined;
        return {
          calendars: calendars.map((calendar) =>
            toCalendarSummary({
              calendar,
              colors,
              connectionId: input.connectionId,
            })
          ),
        };
      }
    );
  } catch (error) {
    return readCalendarFailure(error);
  }
};

const listCalendarColorsForUserGoogle = async (
  input: UserRequest & { connectionId: string }
): Promise<{ colors: string[] }> => {
  const account = await getAuthorizedCalendarAccount(input);
  try {
    return await runAuthorizedGmailMailbox(
      {
        isUnauthorized: (error) =>
          error instanceof ConnectorHttpError && error.status === 401,
        mailboxId: account.mailboxId,
        retryUnauthorized: input.retryUnauthorized,
        userId: input.userId,
      },
      async (accessToken) => {
        const colors = await getGoogleColors({
          accessToken,
          signal: input.signal,
        });
        return {
          colors: Object.values(colors.event).map((color) => color.background),
        };
      }
    );
  } catch (error) {
    return readCalendarFailure(error);
  }
};

const updateCalendarColorForUserGoogle = async (
  input: z.infer<typeof calendarUpdateColorInputSchema> & UserRequest
): Promise<CalendarSummary> =>
  await withCalendar(input, "preference-write", async (context) => {
    const calendar = await patchGoogleCalendarColor({
      ...context,
      color: input.color,
    });
    return toCalendarSummary({ calendar, connectionId: context.connectionId });
  });

const listCalendarEventsForUserGoogle = async (
  input: z.infer<typeof calendarEventsInputSchema> & UserRequest
): Promise<{ events: CalendarEvent[] }> =>
  await withCalendar(input, "read", async (context) => {
    const events = await listGoogleEvents({
      ...context,
      end: input.end,
      query: input.query,
      start: input.start,
      timeZone: input.timeZone,
    });
    const colors =
      events.some((event) => event.colorId) ||
      (!context.calendar.backgroundColor && context.calendar.colorId)
        ? await getGoogleColors(context)
        : undefined;
    return {
      events: events.map((event) =>
        toCalendarEvent({ ...context, colors, event })
      ),
    };
  });

const getCalendarEventForUserGoogle = async (
  input: CalendarEventRef & UserRequest
): Promise<CalendarEvent> =>
  await withCalendar(
    input,
    "read",
    async (context) =>
      await readCalendarEvent(
        context,
        await getGoogleEvent({ ...context, eventId: input.eventId })
      )
  );

const createCalendarEventForUserGoogle = async (
  input: z.infer<typeof calendarCreateInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, "event-write", async (context) => {
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
      colors: input.event.color ? await getGoogleColors(context) : undefined,
      event: input.event,
      operationId: input.operationId,
      userId: input.userId,
    });
    return {
      action: "created",
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      event: await readCalendarEvent(context, event),
      eventId: event.id,
      status: "success",
    };
  });

const updateCalendarEventForUserGoogle = async (
  input: z.infer<typeof calendarUpdateInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, "event-write", async (context) => {
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
      colors: input.changes.color ? await getGoogleColors(context) : undefined,
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
      event: await readCalendarEvent(context, event),
      eventId: event.id,
      status: "success",
    };
  });

const deleteCalendarEventForUserGoogle = async (
  input: z.infer<typeof calendarDeleteInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, "event-write", async (context) => {
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

const respondToCalendarEventForUserGoogle = async (
  input: z.infer<typeof calendarRespondInputSchema> & UserRequest
): Promise<CalendarMutationResult> =>
  await withCalendar(input, "event-write", async (context) => {
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
      sendUpdates: "all",
      version: input.version,
    });
    return {
      action: "responded",
      calendarId: context.calendarId,
      connectionId: context.connectionId,
      event: await readCalendarEvent(context, event),
      eventId: event.id,
      status: "success",
    };
  });

export const resolveCalendarImportTargetForUser = async (
  input: UserRequest & { calendarId?: string; connectionId?: string }
): Promise<CalendarRef> => {
  if (input.connectionId) {
    await getAuthorizedCalendarAccount({
      ...input,
      connectionId: input.connectionId,
    });
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
  await withCalendar(input, "event-write", async (context) => {
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
      event: await readCalendarEvent(context, event),
      htmlLink: event.htmlLink,
      id: event.id,
      status: "success" as const,
      summary: event.summary ?? input.event.summary,
    };
  });

const withCalendarProvider = async <
  Input extends UserRequest & { connectionId: string },
  Result,
>(
  input: Input,
  google: (request: Input) => Promise<Result>,
  microsoft: (request: Input) => Promise<Result>
): Promise<Result> => {
  const account = await getCalendarAccountForUser(input);
  try {
    return await (account.provider === "microsoft_calendar"
      ? microsoft(input)
      : google(input));
  } catch (error) {
    return readCalendarFailure(error);
  }
};

export const listCalendarsForUser = async (
  input: UserRequest & { connectionId: string }
) =>
  await withCalendarProvider(
    input,
    listCalendarsForUserGoogle,
    listMicrosoftCalendarsForUser
  );

export const listCalendarColorsForUser = async (
  input: UserRequest & { connectionId: string }
): Promise<{ colors: string[] }> => {
  const account = await getCalendarAccountForUser(input);
  return account.provider === "microsoft_calendar"
    ? { colors: [] }
    : await listCalendarColorsForUserGoogle(input);
};

export const updateCalendarColorForUser = async (
  input: z.infer<typeof calendarUpdateColorInputSchema> & UserRequest
) =>
  await withCalendarProvider(
    input,
    updateCalendarColorForUserGoogle,
    updateMicrosoftCalendarColorForUser
  );

export const listCalendarEventsForUser = async (
  input: z.infer<typeof calendarEventsInputSchema> & UserRequest
) =>
  await withCalendarProvider(
    input,
    listCalendarEventsForUserGoogle,
    listMicrosoftCalendarEventsForUser
  );

export const getCalendarEventForUser = async (
  input: CalendarEventRef & UserRequest
) =>
  await withCalendarProvider(
    input,
    getCalendarEventForUserGoogle,
    getMicrosoftCalendarEventForUser
  );

export const createCalendarEventForUser = async (
  input: z.infer<typeof calendarCreateInputSchema> & UserRequest
) =>
  await withCalendarProvider(
    input,
    createCalendarEventForUserGoogle,
    createMicrosoftCalendarEventForUser
  );

export const updateCalendarEventForUser = async (
  input: z.infer<typeof calendarUpdateInputSchema> & UserRequest
) =>
  await withCalendarProvider(
    input,
    updateCalendarEventForUserGoogle,
    updateMicrosoftCalendarEventForUser
  );

export const deleteCalendarEventForUser = async (
  input: z.infer<typeof calendarDeleteInputSchema> & UserRequest
) =>
  await withCalendarProvider(
    input,
    deleteCalendarEventForUserGoogle,
    deleteMicrosoftCalendarEventForUser
  );

export const respondToCalendarEventForUser = async (
  input: z.infer<typeof calendarRespondInputSchema> & UserRequest
) =>
  await withCalendarProvider(
    input,
    respondToCalendarEventForUserGoogle,
    respondToMicrosoftCalendarEventForUser
  );
