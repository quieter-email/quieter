import { ORPCError } from "@orpc/server";
import { auth } from "@quieter/auth";
import { db } from "@quieter/database/client";
import {
  connectorCredential,
  connectorOAuthState,
  type ConnectorProvider,
} from "@quieter/database/schema";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { getMessageAttachment } from "@quieter/gmail";
import { and, eq, lt } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { parseIcsToGoogleCalendarEvent, type GoogleCalendarEventDraft } from "./ical";

export const GOOGLE_CALENDAR_CONNECTOR_PROVIDER = "google_calendar" as const;
export const CONNECTOR_PROVIDERS = [GOOGLE_CALENDAR_CONNECTOR_PROVIDER] as const;
export const connectorProviderSchema = z.enum(CONNECTOR_PROVIDERS);

export type ConnectorConnectionStatus = "connected" | "needs_reconnect" | "not_connected";
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
export type ConnectorListItem = {
  accountEmail?: string | null;
  connectedAt?: Date;
  description: string;
  displayName: string;
  isConfigured: boolean;
  provider: ConnectorProvider;
  status: ConnectorConnectionStatus;
  supportsChatTools: boolean;
};

const CONNECTOR_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
const permanentGoogleTokenErrors = new Set(["invalid_grant", "invalid_token"]);

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().min(1),
  token_type: z.string().min(1),
});

const googleRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1).optional(),
  token_type: z.string().min(1),
});

const googleTokenInfoSchema = z.object({
  aud: z.string().min(1),
  email: z.string().email(),
  email_verified: z.enum(["true", "false"]),
  exp: z.coerce.number().int().positive(),
  iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
  name: z.string().optional(),
  sub: z.string().min(1),
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

const connectorDefinitions = {
  [GOOGLE_CALENDAR_CONNECTOR_PROVIDER]: {
    description: "Add calendar invitations from mail and let chat create events.",
    displayName: "Google Calendar",
    scopes: GOOGLE_CALENDAR_SCOPES,
    supportsChatTools: true,
  },
} as const satisfies Record<
  ConnectorProvider,
  {
    description: string;
    displayName: string;
    scopes: readonly string[];
    supportsChatTools: boolean;
  }
>;

const normalizeReturnTo = (returnTo: string | undefined) => {
  const normalized = returnTo?.trim();
  return normalized?.startsWith("/") && !normalized.startsWith("//") ? normalized : "/settings";
};

const createCodeVerifier = () => randomBytes(48).toString("base64url");
const createCodeChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const getGoogleCalendarOAuthClient = () => ({
  clientId: requireServerEnv("GOOGLE_CALENDAR_CLIENT_ID"),
  clientSecret: requireServerEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
});

const isGoogleCalendarClientConfigured = () =>
  !!(
    serverEnv.GOOGLE_CALENDAR_CLIENT_ID &&
    serverEnv.GOOGLE_CALENDAR_CLIENT_SECRET &&
    serverEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY
  );

const isGoogleCalendarOAuthConfigured = () =>
  !!serverEnv.BETTER_AUTH_URL && isGoogleCalendarClientConfigured();

const assertConnectorConfigured = (provider: ConnectorProvider) => {
  if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER && isGoogleCalendarOAuthConfigured()) {
    return;
  }

  throw new ORPCError("BAD_REQUEST", {
    message: `${connectorDefinitions[provider].displayName} connection is not configured for this environment.`,
  });
};

const getConnectorOAuthClient = (provider: ConnectorProvider) => {
  if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    return getGoogleCalendarOAuthClient();
  }

  throw new ORPCError("BAD_REQUEST", { message: "Connector is not supported." });
};

const getConnectorOAuthConfig = (provider: ConnectorProvider) => {
  assertConnectorConfigured(provider);

  if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    const baseUrl = requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/, "");
    return {
      ...getGoogleCalendarOAuthClient(),
      redirectUri: `${baseUrl}/api/connectors/callback`,
    };
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

const exchangeGoogleAuthorizationCode = async (
  provider: ConnectorProvider,
  code: string,
  codeVerifier: string,
) => {
  const config = getConnectorOAuthConfig(provider);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Google rejected the connector authorization code.");
  }
  return googleTokenResponseSchema.parse(await response.json());
};

const validateGoogleIdToken = async (provider: ConnectorProvider, idToken: string) => {
  const config = getConnectorOAuthConfig(provider);
  const response = await fetch(`${GOOGLE_TOKEN_INFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) {
    throw new Error("Google returned an invalid identity token.");
  }

  const tokenInfo = googleTokenInfoSchema.parse(await response.json());
  if (
    tokenInfo.aud !== config.clientId ||
    tokenInfo.email_verified !== "true" ||
    tokenInfo.exp * 1000 <= Date.now()
  ) {
    throw new Error("Google returned an invalid identity token.");
  }
  return tokenInfo;
};

export const listConnectors = async (
  userId: string,
): Promise<{ connectors: ConnectorListItem[] }> => {
  const credentials = await db
    .select({
      accountEmail: connectorCredential.accountEmail,
      createdAt: connectorCredential.createdAt,
      provider: connectorCredential.provider,
      status: connectorCredential.status,
    })
    .from(connectorCredential)
    .where(eq(connectorCredential.userId, userId));

  return {
    connectors: CONNECTOR_PROVIDERS.map((provider) => {
      const credential = credentials.find((row) => row.provider === provider);
      const definition = connectorDefinitions[provider];

      return {
        accountEmail: credential?.accountEmail,
        connectedAt: credential?.createdAt,
        description: definition.description,
        displayName: definition.displayName,
        isConfigured:
          provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER
            ? isGoogleCalendarOAuthConfigured()
            : false,
        provider,
        status: credential?.status ?? "not_connected",
        supportsChatTools: definition.supportsChatTools,
      };
    }),
  };
};

export const startConnectorOAuth = async (input: {
  provider: ConnectorProvider;
  returnTo?: string;
  userId: string;
}) => {
  assertConnectorConfigured(input.provider);
  await db.delete(connectorOAuthState).where(lt(connectorOAuthState.expiresAt, new Date()));

  const state = randomBytes(32).toString("base64url");
  const codeVerifier = createCodeVerifier();
  const now = new Date();
  await db.insert(connectorOAuthState).values({
    codeVerifier,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CONNECTOR_OAUTH_STATE_TTL_MS),
    id: state,
    provider: input.provider,
    returnTo: normalizeReturnTo(input.returnTo),
    userId: input.userId,
  });

  const config = getConnectorOAuthConfig(input.provider);
  const definition = connectorDefinitions[input.provider];
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("prompt", "consent select_account");
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", definition.scopes.join(" "));
  authorizationUrl.searchParams.set("state", state);

  return { authorizationUrl: authorizationUrl.toString() };
};

export const completeConnectorOAuth = async (input: {
  code: string;
  headers: Headers;
  state: string;
}) => {
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session?.user || !session.session) {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in before connecting this account." });
  }

  const [oauthState] = await db
    .delete(connectorOAuthState)
    .where(eq(connectorOAuthState.id, input.state))
    .returning();

  if (
    !oauthState ||
    oauthState.userId !== session.user.id ||
    oauthState.expiresAt.getTime() <= Date.now()
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This connector request is invalid or expired.",
    });
  }

  const tokenResponse = await exchangeGoogleAuthorizationCode(
    oauthState.provider,
    input.code,
    oauthState.codeVerifier,
  );
  const tokenInfo = await validateGoogleIdToken(oauthState.provider, tokenResponse.id_token);
  const definition = connectorDefinitions[oauthState.provider];
  const grantedScopes = new Set(tokenResponse.scope.split(/\s+/).filter(Boolean));
  if (!definition.scopes.every((scope) => grantedScopes.has(scope))) {
    throw new Error("Google did not grant all required connector permissions.");
  }

  const [existingCredential] = await db
    .select({
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, session.user.id),
        eq(connectorCredential.provider, oauthState.provider),
      ),
    )
    .limit(1);
  const encryptedRefreshToken = tokenResponse.refresh_token
    ? encryptConnectorSecret(tokenResponse.refresh_token)
    : existingCredential?.encryptedRefreshToken;
  if (!encryptedRefreshToken) {
    throw new Error("Google did not return an offline refresh token. Reconnect and grant access.");
  }

  const now = new Date();
  await db
    .insert(connectorCredential)
    .values({
      accessTokenExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000),
      accountEmail: tokenInfo.email,
      createdAt: now,
      displayName: tokenInfo.name ?? tokenInfo.email,
      encryptedAccessToken: encryptConnectorSecret(tokenResponse.access_token),
      encryptedRefreshToken,
      id: existingCredential?.id ?? randomUUID(),
      provider: oauthState.provider,
      providerAccountId: tokenInfo.sub,
      scopes: tokenResponse.scope,
      status: "connected",
      updatedAt: now,
      userId: session.user.id,
    })
    .onConflictDoUpdate({
      set: {
        accessTokenExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000),
        accountEmail: tokenInfo.email,
        displayName: tokenInfo.name ?? tokenInfo.email,
        encryptedAccessToken: encryptConnectorSecret(tokenResponse.access_token),
        encryptedRefreshToken,
        providerAccountId: tokenInfo.sub,
        scopes: tokenResponse.scope,
        status: "connected",
        updatedAt: now,
      },
      target: [connectorCredential.userId, connectorCredential.provider],
    });

  return {
    provider: oauthState.provider,
    returnTo: oauthState.returnTo,
  };
};

export const disconnectConnector = async (input: {
  provider: ConnectorProvider;
  userId: string;
}) => {
  const [deleted] = await db
    .delete(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider),
      ),
    )
    .returning({ id: connectorCredential.id });

  return { disconnected: Boolean(deleted), provider: input.provider };
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

export const runAuthorizedConnector = async <TValue>(
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
  importEvent: boolean;
  signal?: AbortSignal;
}) => {
  const endpoint = input.importEvent
    ? `${GOOGLE_CALENDAR_API_URL}/calendars/primary/events/import`
    : `${GOOGLE_CALENDAR_API_URL}/calendars/primary/events`;
  const response = await fetch(endpoint, {
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
        importEvent: false,
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

const decodeBase64UrlText = (value: string) =>
  Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");

export const addIcsAttachmentToGoogleCalendar = async (input: {
  attachmentId: string;
  mailboxId: string;
  messageId: string;
  signal?: AbortSignal;
  userId: string;
}) => {
  const attachment = await runAuthorizedGmailMailbox(
    { mailboxId: input.mailboxId, userId: input.userId },
    async (accessToken) =>
      await getMessageAttachment(accessToken, input.messageId, input.attachmentId, input.signal),
  );
  if (!attachment.data) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This calendar invitation could not be read.",
    });
  }

  const parsedEvent = parseIcsToGoogleCalendarEvent(decodeBase64UrlText(attachment.data));
  const importedEvent = await runAuthorizedConnector(
    {
      provider: GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, signal) => {
      const event = await postGoogleCalendarEvent({
        accessToken,
        event: {
          ...parsedEvent,
          iCalUID: parsedEvent.iCalUID ?? `${randomUUID()}@quieter.email`,
        },
        importEvent: true,
        signal,
      });

      return {
        htmlLink: event.htmlLink,
        id: event.id,
        status: "success" as const,
        summary: event.summary ?? parsedEvent.summary,
      };
    },
  );

  return importedEvent;
};
