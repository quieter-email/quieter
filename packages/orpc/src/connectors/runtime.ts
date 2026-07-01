import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { connectorCredential, type ConnectorProvider } from "@quieter/database/schema";
import { requireServerEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";

export const GOOGLE_CALENDAR_CONNECTOR_PROVIDER = "google_calendar" as const;
const CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
const permanentGoogleTokenErrors = new Set(["invalid_grant", "invalid_token"]);

export type GoogleCalendarEventInput = {
  description?: string;
  end: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  location?: string;
  start: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  summary: string;
};

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

const connectorDefinitions = {
  [GOOGLE_CALENDAR_CONNECTOR_PROVIDER]: {
    displayName: "Google Calendar",
    scopes: GOOGLE_CALENDAR_SCOPES,
  },
} as const satisfies Record<
  ConnectorProvider,
  {
    displayName: string;
    scopes: readonly string[];
  }
>;

const googleRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1).optional(),
  token_type: z.string().min(1),
});

const googleApiErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  }),
});

const googleCalendarEventResponseSchema = z.object({
  htmlLink: z.string().url().optional(),
  id: z.string().min(1),
  summary: z.string().optional(),
});

const getGoogleCalendarOAuthClient = () => ({
  clientId: requireServerEnv("GOOGLE_CALENDAR_CLIENT_ID"),
  clientSecret: requireServerEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
});

const getConnectorOAuthClient = (provider: ConnectorProvider) => {
  if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    return getGoogleCalendarOAuthClient();
  }

  throw new ORPCError("BAD_REQUEST", { message: "Connector is not supported." });
};

const getConnectorCredentialEncryptionKey = () =>
  requireServerEnv("CONNECTOR_TOKEN_ENCRYPTION_KEY");

const encryptConnectorSecret = (value: string) =>
  encryptGmailCredentialSecret(value, { legacyKey: getConnectorCredentialEncryptionKey() });

const decryptConnectorSecret = (value: string) =>
  decryptGmailCredentialSecret(value, { legacyKey: getConnectorCredentialEncryptionKey() });

const createGoogleApiError = async (response: Response) => {
  const body = await response.text().catch(() => "");
  const parsedBody = (() => {
    if (!body.trim()) {
      return null;
    }

    try {
      return googleApiErrorSchema.parse(JSON.parse(body));
    } catch {
      return null;
    }
  })();
  const message =
    parsedBody?.error.message ||
    body ||
    `Google Calendar request failed with status ${response.status}.`;
  const error = new Error(message) as Error & { status: number };
  error.status = response.status;
  return error;
};

export const hasConnectedConnector = async (input: {
  provider: ConnectorProvider;
  userId: string;
}) => {
  const [credential] = await db
    .select({ id: connectorCredential.id })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider),
        eq(connectorCredential.status, "connected"),
      ),
    )
    .limit(1);

  return Boolean(credential);
};

const getConnectorRepairRequiredError = (provider: ConnectorProvider) =>
  new ORPCError("BAD_REQUEST", {
    message: `Reconnect ${connectorDefinitions[provider].displayName} before using this action.`,
  });

const refreshConnectorAccessToken = async (record: {
  encryptedRefreshToken: string | null;
  id: string;
  provider: ConnectorProvider;
}) => {
  if (!record.encryptedRefreshToken) {
    await db
      .update(connectorCredential)
      .set({ status: "needs_reconnect", updatedAt: new Date() })
      .where(eq(connectorCredential.id, record.id));
    throw getConnectorRepairRequiredError(record.provider);
  }

  const config = getConnectorOAuthClient(record.provider);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptConnectorSecret(record.encryptedRefreshToken),
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response
      .json()
      .then((value: unknown) => z.object({ error: z.string().optional() }).safeParse(value))
      .catch(() => null);
    const errorCode = body?.success ? body.data.error : undefined;
    if (
      response.status === 400 ||
      response.status === 401 ||
      (errorCode && permanentGoogleTokenErrors.has(errorCode))
    ) {
      await db
        .update(connectorCredential)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(connectorCredential.id, record.id));
      throw getConnectorRepairRequiredError(record.provider);
    }

    throw new Error(`Google token refresh failed with status ${response.status}.`);
  }

  const refreshed = googleRefreshResponseSchema.parse(await response.json());
  const now = new Date();
  await db
    .update(connectorCredential)
    .set({
      accessTokenExpiresAt: new Date(now.getTime() + refreshed.expires_in * 1000),
      encryptedAccessToken: encryptConnectorSecret(refreshed.access_token),
      scopes: refreshed.scope ?? connectorDefinitions[record.provider].scopes.join(" "),
      status: "connected",
      updatedAt: now,
    })
    .where(eq(connectorCredential.id, record.id));

  return refreshed.access_token;
};

const getAuthorizedConnectorAccessToken = async (input: {
  provider: ConnectorProvider;
  userId: string;
}) => {
  const [record] = await db
    .select({
      accessTokenExpiresAt: connectorCredential.accessTokenExpiresAt,
      encryptedAccessToken: connectorCredential.encryptedAccessToken,
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
      status: connectorCredential.status,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider),
      ),
    )
    .limit(1);

  if (!record) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  if (record.status === "needs_reconnect") {
    throw getConnectorRepairRequiredError(record.provider);
  }

  if (
    record.encryptedAccessToken &&
    record.accessTokenExpiresAt &&
    record.accessTokenExpiresAt.getTime() > Date.now() + CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS
  ) {
    return decryptConnectorSecret(record.encryptedAccessToken);
  }

  return await refreshConnectorAccessToken(record);
};

const refreshAuthorizedConnectorAccessToken = async (input: {
  provider: ConnectorProvider;
  userId: string;
}) => {
  const [record] = await db
    .select({
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider),
      ),
    )
    .limit(1);

  if (!record) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  return await refreshConnectorAccessToken(record);
};

const runAuthorizedConnector = async <TValue>(
  input: { provider: ConnectorProvider; signal?: AbortSignal; userId: string },
  runner: (accessToken: string, signal?: AbortSignal) => Promise<TValue>,
) => {
  const accessToken = await getAuthorizedConnectorAccessToken(input);

  try {
    return await runner(accessToken, input.signal);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("status" in error) ||
      (error as { status?: unknown }).status !== 401
    ) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshAuthorizedConnectorAccessToken(input);
  return await runner(refreshedAccessToken, input.signal);
};

const postGoogleCalendarEvent = async (input: {
  accessToken: string;
  event: GoogleCalendarEventDraft;
  signal?: AbortSignal;
}) => {
  const response = await fetch(`${GOOGLE_CALENDAR_API_URL}/calendars/primary/events`, {
    body: JSON.stringify(input.event),
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: input.signal,
  });

  if (!response.ok) {
    throw await createGoogleApiError(response);
  }

  return googleCalendarEventResponseSchema.parse(await response.json());
};

type GoogleCalendarEventDraft = {
  description?: string;
  end:
    | { date: string; dateTime?: never; timeZone?: never }
    | { date?: never; dateTime: string; timeZone?: string };
  location?: string;
  start:
    | { date: string; dateTime?: never; timeZone?: never }
    | { date?: never; dateTime: string; timeZone?: string };
  summary: string;
};

const normalizeGoogleCalendarEventDate = (
  value: GoogleCalendarEventInput["start"],
): GoogleCalendarEventDraft["start"] => {
  if (value.date && !value.dateTime) {
    return { date: value.date };
  }

  if (value.dateTime && !value.date) {
    return value.timeZone
      ? { dateTime: value.dateTime, timeZone: value.timeZone }
      : { dateTime: value.dateTime };
  }

  throw new ORPCError("BAD_REQUEST", {
    message: "Calendar events require exactly one date or date-time for both start and end.",
  });
};

const normalizeGoogleCalendarEvent = (
  event: GoogleCalendarEventInput,
): GoogleCalendarEventDraft => ({
  ...(event.description ? { description: event.description } : {}),
  end: normalizeGoogleCalendarEventDate(event.end),
  ...(event.location ? { location: event.location } : {}),
  start: normalizeGoogleCalendarEventDate(event.start),
  summary: event.summary,
});

export const createGoogleCalendarEventForUser = async (input: {
  event: GoogleCalendarEventInput;
  signal?: AbortSignal;
  userId: string;
}) =>
  await runAuthorizedConnector(
    {
      provider: GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, signal) => {
      const eventDraft = normalizeGoogleCalendarEvent(input.event);
      const event = await postGoogleCalendarEvent({
        accessToken,
        event: eventDraft,
        signal,
      });

      return {
        htmlLink: event.htmlLink,
        id: event.id,
        status: "success" as const,
        summary: event.summary ?? eventDraft.summary,
      };
    },
  );
