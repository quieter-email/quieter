import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { connectorCredential } from "@quieter/database/schema";
import type { ConnectorProvider } from "@quieter/database/schema";
import { requireServerEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";
import { hasText } from "../text";
import {
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  LINEAR_CONNECTOR_PROVIDER,
} from "./contracts";

export {
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  LINEAR_CONNECTOR_PROVIDER,
} from "./contracts";
const CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
export const LINEAR_AUTHORIZATION_URL = "https://linear.app/oauth/authorize";
export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const permanentGoogleTokenErrors = new Set(["invalid_grant", "invalid_token"]);
const permanentLinearTokenErrors = new Set(["invalid_grant", "invalid_token"]);

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
// The agent reaches Linear through the workspace's own tools, so the grant has to
// cover the changes those tools make. Connections made under the older, narrower
// grant keep working for reads and fail the rest until they are reconnected.
export const LINEAR_SCOPES = ["read", "write"] as const;

const connectorDefinitions = {
  [GOOGLE_CALENDAR_CONNECTOR_PROVIDER]: {
    displayName: "Google Calendar",
    scopes: GOOGLE_CALENDAR_SCOPES,
  },
  [LINEAR_CONNECTOR_PROVIDER]: {
    displayName: "Linear",
    scopes: LINEAR_SCOPES,
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

const linearRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
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
  htmlLink: z.url().optional(),
  id: z.string().min(1),
  summary: z.string().optional(),
});

const getGoogleCalendarOAuthClient = () => ({
  clientId: requireServerEnv("GOOGLE_CALENDAR_CLIENT_ID"),
  clientSecret: requireServerEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
});

const getLinearOAuthClient = () => ({
  clientId: requireServerEnv("LINEAR_CLIENT_ID"),
  clientSecret: requireServerEnv("LINEAR_CLIENT_SECRET"),
});

const getConnectorOAuthClient = (provider: ConnectorProvider) => {
  if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    return getGoogleCalendarOAuthClient();
  }
  if (provider === LINEAR_CONNECTOR_PROVIDER) {
    return getLinearOAuthClient();
  }

  throw new ORPCError("BAD_REQUEST", {
    message: "Connector is not supported.",
  });
};

const getConnectorCredentialEncryptionKey = () =>
  requireServerEnv("CONNECTOR_TOKEN_ENCRYPTION_KEY");

const encryptConnectorSecret = (value: string) =>
  encryptGmailCredentialSecret(value, {
    legacyKey: getConnectorCredentialEncryptionKey(),
  });

const decryptConnectorSecret = (value: string) =>
  decryptGmailCredentialSecret(value, {
    legacyKey: getConnectorCredentialEncryptionKey(),
  });

const normalizeOAuthScope = (scope: string | string[]) =>
  Array.isArray(scope) ? scope.join(" ") : scope;

class ConnectorHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ConnectorHttpError";
    this.status = status;
  }
}

const createGoogleApiError = async (response: Response) => {
  const body = await response.text().catch(() => "");
  const parsedBody = (() => {
    if (!hasText(body.trim())) {
      return null;
    }

    try {
      return googleApiErrorSchema.parse(JSON.parse(body));
    } catch {
      return null;
    }
  })();
  const message =
    parsedBody?.error.message ??
    (hasText(body)
      ? body
      : `Google Calendar request failed with status ${response.status}.`);
  return new ConnectorHttpError(message, response.status);
};

const hasCachedConnectorAccessToken = (record: {
  accessTokenExpiresAt: Date | null;
  encryptedAccessToken: string | null;
}): record is {
  accessTokenExpiresAt: Date;
  encryptedAccessToken: string;
} =>
  hasText(record.encryptedAccessToken) &&
  record.accessTokenExpiresAt !== null &&
  record.accessTokenExpiresAt.getTime() >
    Date.now() + CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS;

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
        eq(connectorCredential.status, "connected")
      )
    )
    .limit(1);

  return Boolean(credential);
};

const getConnectorRepairRequiredError = (provider: ConnectorProvider) =>
  new ORPCError("BAD_REQUEST", {
    message: `Reconnect ${connectorDefinitions[provider].displayName} before using this action.`,
  });

/**
 * A refresh returns a token carrying the scopes the user originally granted. When the
 * response omits them, the stored grant is what the token still has — writing the
 * connector's current definition instead would claim scopes this credential never got.
 */
const getRefreshedScopes = (
  record: { scopes: string | null },
  scope: string | string[] | undefined
) => (scope === undefined ? (record.scopes ?? "") : normalizeOAuthScope(scope));

/** A grant missing a scope the connector now needs cannot serve its tools. */
const hasRequiredConnectorScopes = (
  provider: ConnectorProvider,
  scopes: string
) => {
  const granted = new Set(scopes.split(" ").filter((value) => value !== ""));
  return connectorDefinitions[provider].scopes.every((scope) =>
    granted.has(scope)
  );
};

const refreshConnectorAccessToken = async (record: {
  encryptedRefreshToken: string | null;
  id: string;
  provider: ConnectorProvider;
  scopes: string | null;
}) => {
  if (!hasText(record.encryptedRefreshToken)) {
    await db
      .update(connectorCredential)
      .set({ status: "needs_reconnect", updatedAt: new Date() })
      .where(eq(connectorCredential.id, record.id));
    throw getConnectorRepairRequiredError(record.provider);
  }

  const config = getConnectorOAuthClient(record.provider);
  const response = await fetch(
    record.provider === LINEAR_CONNECTOR_PROVIDER
      ? LINEAR_TOKEN_URL
      : GOOGLE_TOKEN_URL,
    {
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: decryptConnectorSecret(record.encryptedRefreshToken),
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }
  );

  if (!response.ok) {
    const body = await response
      .json()
      .then((value: unknown) =>
        z.object({ error: z.string().optional() }).safeParse(value)
      )
      .catch(() => null);
    const errorCode = body?.success === true ? body.data.error : undefined;
    const permanentErrors =
      record.provider === LINEAR_CONNECTOR_PROVIDER
        ? permanentLinearTokenErrors
        : permanentGoogleTokenErrors;
    if (
      response.status === 400 ||
      response.status === 401 ||
      (errorCode !== undefined && permanentErrors.has(errorCode))
    ) {
      await db
        .update(connectorCredential)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(connectorCredential.id, record.id));
      throw getConnectorRepairRequiredError(record.provider);
    }

    throw new Error(
      `${connectorDefinitions[record.provider].displayName} token refresh failed with status ${response.status}.`
    );
  }

  const refreshed =
    record.provider === LINEAR_CONNECTOR_PROVIDER
      ? linearRefreshResponseSchema.parse(await response.json())
      : googleRefreshResponseSchema.parse(await response.json());
  const now = new Date();
  const scopes = getRefreshedScopes(record, refreshed.scope);
  await db
    .update(connectorCredential)
    .set({
      accessTokenExpiresAt: new Date(
        now.getTime() + refreshed.expires_in * 1000
      ),
      encryptedAccessToken: encryptConnectorSecret(refreshed.access_token),
      encryptedRefreshToken:
        "refresh_token" in refreshed && hasText(refreshed.refresh_token)
          ? encryptConnectorSecret(refreshed.refresh_token)
          : record.encryptedRefreshToken,
      scopes,
      // An older, narrower grant still refreshes, but it cannot do what the connector
      // now asks of it, so it is surfaced as needing a reconnect rather than silently
      // failing at the first call that needs the missing scope.
      status: hasRequiredConnectorScopes(record.provider, scopes)
        ? "connected"
        : "needs_reconnect",
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
      scopes: connectorCredential.scopes,
      status: connectorCredential.status,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider)
      )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  if (record.status === "needs_reconnect") {
    throw getConnectorRepairRequiredError(record.provider);
  }

  if (hasCachedConnectorAccessToken(record)) {
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
      scopes: connectorCredential.scopes,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider)
      )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  return await refreshConnectorAccessToken(record);
};

const runAuthorizedConnector = async <TValue>(
  input: { provider: ConnectorProvider; signal?: AbortSignal; userId: string },
  runner: (accessToken: string, signal?: AbortSignal) => Promise<TValue>
) => {
  const accessToken = await getAuthorizedConnectorAccessToken(input);

  try {
    return await runner(accessToken, input.signal);
  } catch (error) {
    if (!(error instanceof ConnectorHttpError) || error.status !== 401) {
      throw error;
    }
  }

  const refreshedAccessToken =
    await refreshAuthorizedConnectorAccessToken(input);
  return await runner(refreshedAccessToken, input.signal);
};

const getAuthorizedConnectorCredentialAccessToken = async (input: {
  credentialId: string;
  provider: ConnectorProvider;
  userId?: string;
}) => {
  const [record] = await db
    .select({
      accessTokenExpiresAt: connectorCredential.accessTokenExpiresAt,
      encryptedAccessToken: connectorCredential.encryptedAccessToken,
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
      scopes: connectorCredential.scopes,
      status: connectorCredential.status,
      userId: connectorCredential.userId,
    })
    .from(connectorCredential)
    .where(
      input.userId === undefined
        ? and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider)
          )
        : and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
            eq(connectorCredential.userId, input.userId)
          )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  if (record.status === "needs_reconnect") {
    throw getConnectorRepairRequiredError(record.provider);
  }

  const accessToken = hasCachedConnectorAccessToken(record)
    ? decryptConnectorSecret(record.encryptedAccessToken)
    : await refreshConnectorAccessToken(record);

  return { accessToken, userId: record.userId };
};

const refreshAuthorizedConnectorCredentialAccessToken = async (input: {
  credentialId: string;
  provider: ConnectorProvider;
  userId?: string;
}) => {
  const [record] = await db
    .select({
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
      scopes: connectorCredential.scopes,
    })
    .from(connectorCredential)
    .where(
      input.userId === undefined
        ? and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider)
          )
        : and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
            eq(connectorCredential.userId, input.userId)
          )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  return await refreshConnectorAccessToken(record);
};

const runAuthorizedConnectorCredential = async <TValue>(
  input: {
    credentialId: string;
    provider: ConnectorProvider;
    signal?: AbortSignal;
    userId?: string;
  },
  runner: (
    accessToken: string,
    credential: { userId: string },
    signal?: AbortSignal
  ) => Promise<TValue>
) => {
  const credential = await getAuthorizedConnectorCredentialAccessToken(input);

  try {
    return await runner(
      credential.accessToken,
      { userId: credential.userId },
      input.signal
    );
  } catch (error) {
    if (!(error instanceof ConnectorHttpError) || error.status !== 401) {
      throw error;
    }
  }

  const refreshedAccessToken =
    await refreshAuthorizedConnectorCredentialAccessToken(input);
  return await runner(
    refreshedAccessToken,
    { userId: credential.userId },
    input.signal
  );
};

const postGoogleCalendarEvent = async (input: {
  accessToken: string;
  event: GoogleCalendarEventDraft;
  signal?: AbortSignal;
}) => {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_URL}/calendars/primary/events`,
    {
      body: JSON.stringify(input.event),
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: input.signal,
    }
  );

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
  value: GoogleCalendarEventInput["start"]
): GoogleCalendarEventDraft["start"] => {
  if (hasText(value.date) && !hasText(value.dateTime)) {
    return { date: value.date };
  }

  if (hasText(value.dateTime) && !hasText(value.date)) {
    if (hasText(value.timeZone)) {
      return { dateTime: value.dateTime, timeZone: value.timeZone };
    }
    return { dateTime: value.dateTime };
  }

  throw new ORPCError("BAD_REQUEST", {
    message:
      "Calendar events require exactly one date or date-time for both start and end.",
  });
};

const normalizeGoogleCalendarEvent = (
  event: GoogleCalendarEventInput
): GoogleCalendarEventDraft => ({
  ...(hasText(event.description) ? { description: event.description } : {}),
  end: normalizeGoogleCalendarEventDate(event.end),
  ...(hasText(event.location) ? { location: event.location } : {}),
  start: normalizeGoogleCalendarEventDate(event.start),
  summary: event.summary,
});

export const getLinearMcpEndpoint = () => LINEAR_MCP_URL;

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
/** The one Linear read that is not a tool call: naming the connection being made. */
const LINEAR_IDENTITY_QUERY = `query ConnectorIdentity {
  viewer { displayName email id name }
  organization { id name }
}`;

const LINEAR_IDENTITY_TIMEOUT_MS = 10_000;

/**
 * GraphQL reports failures inside a 200, so an error body has to be read rather than
 * inferred from the status.
 */
const linearGraphqlErrorSchema = z.object({
  errors: z.array(z.object({ message: z.string().optional() })).min(1),
});

const linearIdentitySchema = z.object({
  data: z.object({
    organization: z.object({
      id: z.string(),
      name: z.string(),
    }),
    viewer: z.object({
      displayName: z.string().nullish(),
      email: z.string(),
      id: z.string(),
      name: z.string().nullish(),
    }),
  }),
});

const resolveLinearDisplayName = (viewer: {
  displayName?: string | null;
  email: string;
  name?: string | null;
}) => {
  if (hasText(viewer.displayName)) {
    return viewer.displayName;
  }
  if (hasText(viewer.name)) {
    return viewer.name;
  }
  return viewer.email;
};

export const getLinearIdentityFromAccessToken = async (accessToken: string) => {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    body: JSON.stringify({ query: LINEAR_IDENTITY_QUERY }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    // This runs while someone waits on the connect screen, so a stalled Linear must
    // fail rather than hold the request open.
    signal: AbortSignal.timeout(LINEAR_IDENTITY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ConnectorHttpError(
      "Linear rejected the connection.",
      response.status
    );
  }

  const body: unknown = await response.json();
  const failure = linearGraphqlErrorSchema.safeParse(body);
  if (failure.success) {
    throw new ConnectorHttpError(
      failure.data.errors[0].message ?? "Linear rejected the connection.",
      response.status
    );
  }

  const parsed = linearIdentitySchema.safeParse(body);
  if (!parsed.success) {
    throw new ConnectorHttpError(
      "Linear did not return the connected account.",
      response.status
    );
  }
  const { data } = parsed.data;
  return {
    accountEmail: data.viewer.email,
    displayName: resolveLinearDisplayName(data.viewer),
    providerAccountId: data.viewer.id,
    providerWorkspaceId: data.organization.id,
    providerWorkspaceName: data.organization.name,
  };
};

/** A refreshed token for the caller's own Linear connection, for the MCP client. */
export const getLinearAccessTokenForUser = async (input: { userId: string }) =>
  await getAuthorizedConnectorAccessToken({
    provider: LINEAR_CONNECTOR_PROVIDER,
    userId: input.userId,
  });

/** The same, for a mailbox action acting on one stored connection. */
export const getLinearAccessTokenForCredential = async (input: {
  credentialId: string;
  signal?: AbortSignal;
  userId?: string;
}) =>
  await runAuthorizedConnectorCredential(
    {
      credentialId: input.credentialId,
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken) => await Promise.resolve(accessToken)
  );

const createGoogleCalendarEvent = async (input: {
  accessToken: string;
  event: GoogleCalendarEventInput;
  signal?: AbortSignal;
}) => {
  const eventDraft = normalizeGoogleCalendarEvent(input.event);
  const event = await postGoogleCalendarEvent({
    accessToken: input.accessToken,
    event: eventDraft,
    signal: input.signal,
  });

  return {
    htmlLink: event.htmlLink,
    id: event.id,
    status: "success" as const,
    summary: event.summary ?? eventDraft.summary,
  };
};

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
    async (accessToken, signal) =>
      await createGoogleCalendarEvent({
        accessToken,
        event: input.event,
        signal,
      })
  );

export const createGoogleCalendarEventForCredential = async (input: {
  credentialId: string;
  event: GoogleCalendarEventInput;
  signal?: AbortSignal;
  userId?: string;
}) =>
  await runAuthorizedConnectorCredential(
    {
      credentialId: input.credentialId,
      provider: GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, _credential, signal) =>
      await createGoogleCalendarEvent({
        accessToken,
        event: input.event,
        signal,
      })
  );
