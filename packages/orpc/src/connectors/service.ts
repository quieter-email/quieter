import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  connectorCredential,
  connectorOAuthState,
} from "@quieter/database/schema";
import type { ConnectorProvider } from "@quieter/database/schema";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { getMessageAttachment } from "@quieter/gmail";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";
import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { hasText } from "../text";
import { parseIcsToGoogleCalendarEvent } from "./ical";
import type { GoogleCalendarEventDraft } from "./ical";
import {
  getLinearIdentityFromAccessToken,
  LINEAR_AUTHORIZATION_URL,
  LINEAR_CONNECTOR_PROVIDER,
  LINEAR_SCOPES,
  LINEAR_TOKEN_URL,
} from "./runtime";

export {
  createLinearIssueForCredential,
  getLinearMcpEndpoint,
  LINEAR_CONNECTOR_PROVIDER,
  LINEAR_SCOPES,
  listLinearIssueMetadataForCredential as listLinearIssueMetadata,
  type LinearIssueCreateDraft,
  type LinearIssueMetadata,
} from "./runtime";

export const GOOGLE_CALENDAR_CONNECTOR_PROVIDER = "google_calendar" as const;
export const CONNECTOR_PROVIDERS = [
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
  LINEAR_CONNECTOR_PROVIDER,
] as const;
export const connectorProviderSchema = z.enum(CONNECTOR_PROVIDERS);

export type ConnectorConnectionStatus =
  | "connected"
  | "needs_reconnect"
  | "not_connected";
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
  accounts: {
    accountEmail?: string | null;
    displayName?: string | null;
    id: string;
    providerAccountId: string;
    providerWorkspaceId?: string | null;
    providerWorkspaceName?: string | null;
    status: ConnectorConnectionStatus;
  }[];
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
const permanentLinearTokenErrors = new Set(["invalid_grant", "invalid_token"]);

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

const linearTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.union([z.string(), z.array(z.string())]),
  token_type: z.string().min(1),
});

const linearRefreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
  token_type: z.string().min(1),
});

const googleTokenInfoSchema = z.object({
  aud: z.string().min(1),
  email: z.email(),
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
  htmlLink: z.url().optional(),
  id: z.string().min(1),
  summary: z.string().optional(),
});

const connectorDefinitions = {
  [GOOGLE_CALENDAR_CONNECTOR_PROVIDER]: {
    description:
      "Add calendar invitations from mail and let chat create events.",
    displayName: "Google Calendar",
    scopes: GOOGLE_CALENDAR_SCOPES,
    supportsChatTools: true,
  },
  [LINEAR_CONNECTOR_PROVIDER]: {
    description: "Create product issues from mailbox action workflows.",
    displayName: "Linear",
    scopes: LINEAR_SCOPES,
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
  if (
    hasText(normalized) &&
    normalized.startsWith("/") &&
    !normalized.startsWith("//")
  ) {
    return normalized;
  }
  return "/settings";
};

const createCodeVerifier = () => randomBytes(48).toString("base64url");
const createCodeChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const getGoogleCalendarOAuthClient = () => ({
  clientId: requireServerEnv("GOOGLE_CALENDAR_CLIENT_ID"),
  clientSecret: requireServerEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
});

const getLinearOAuthClient = () => ({
  clientId: requireServerEnv("LINEAR_CLIENT_ID"),
  clientSecret: requireServerEnv("LINEAR_CLIENT_SECRET"),
});

const isGoogleCalendarClientConfigured = () =>
  hasText(serverEnv.GOOGLE_CALENDAR_CLIENT_ID) &&
  hasText(serverEnv.GOOGLE_CALENDAR_CLIENT_SECRET) &&
  hasText(serverEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY);

const isGoogleCalendarOAuthConfigured = () =>
  hasText(serverEnv.BETTER_AUTH_URL) && isGoogleCalendarClientConfigured();

const isLinearClientConfigured = () =>
  hasText(serverEnv.LINEAR_CLIENT_ID) &&
  hasText(serverEnv.LINEAR_CLIENT_SECRET) &&
  hasText(serverEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY);

const isLinearOAuthConfigured = () =>
  hasText(serverEnv.BETTER_AUTH_URL) && isLinearClientConfigured();

const assertConnectorConfigured = (provider: ConnectorProvider) => {
  if (
    provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER &&
    isGoogleCalendarOAuthConfigured()
  ) {
    return;
  }
  if (provider === LINEAR_CONNECTOR_PROVIDER && isLinearOAuthConfigured()) {
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
  if (provider === LINEAR_CONNECTOR_PROVIDER) {
    return getLinearOAuthClient();
  }

  throw new ORPCError("BAD_REQUEST", {
    message: "Connector is not supported.",
  });
};

const getConnectorOAuthConfig = (provider: ConnectorProvider) => {
  assertConnectorConfigured(provider);

  if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    const baseUrl = requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "");
    return {
      ...getGoogleCalendarOAuthClient(),
      redirectUri: `${baseUrl}/api/connectors/callback`,
    };
  }
  if (provider === LINEAR_CONNECTOR_PROVIDER) {
    const baseUrl = requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "");
    return {
      ...getLinearOAuthClient(),
      redirectUri: `${baseUrl}/api/connectors/callback`,
    };
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

const splitGrantedScopes = (scope: string | string[]) =>
  new Set(
    normalizeOAuthScope(scope)
      .split(/[\s,]+/u)
      .filter(Boolean)
  );

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

const exchangeGoogleAuthorizationCode = async (
  provider: ConnectorProvider,
  code: string,
  codeVerifier: string
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

const validateGoogleIdToken = async (
  provider: ConnectorProvider,
  idToken: string
) => {
  const config = getConnectorOAuthConfig(provider);
  const response = await fetch(
    `${GOOGLE_TOKEN_INFO_URL}?id_token=${encodeURIComponent(idToken)}`
  );
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

const exchangeLinearAuthorizationCode = async (
  code: string,
  codeVerifier: string
) => {
  const config = getConnectorOAuthConfig(LINEAR_CONNECTOR_PROVIDER);
  const response = await fetch(LINEAR_TOKEN_URL, {
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
    throw new Error("Linear rejected the connector authorization code.");
  }
  return linearTokenResponseSchema.parse(await response.json());
};

const getLinearIdentity = async (accessToken: string) =>
  await getLinearIdentityFromAccessToken(accessToken);

export const listConnectors = async (
  userId: string
): Promise<{ connectors: ConnectorListItem[] }> => {
  const credentials = await db
    .select({
      accountEmail: connectorCredential.accountEmail,
      createdAt: connectorCredential.createdAt,
      displayName: connectorCredential.displayName,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
      providerAccountId: connectorCredential.providerAccountId,
      providerWorkspaceId: connectorCredential.providerWorkspaceId,
      providerWorkspaceName: connectorCredential.providerWorkspaceName,
      status: connectorCredential.status,
    })
    .from(connectorCredential)
    .where(eq(connectorCredential.userId, userId));

  return {
    connectors: CONNECTOR_PROVIDERS.map((provider) => {
      const providerCredentials = credentials.filter(
        (row) => row.provider === provider
      );
      const [credential] = providerCredentials;
      const definition = connectorDefinitions[provider];
      let isConfigured = false;
      if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
        isConfigured = isGoogleCalendarOAuthConfigured();
      } else if (provider === LINEAR_CONNECTOR_PROVIDER) {
        isConfigured = isLinearOAuthConfigured();
      }

      return {
        accountEmail: credential?.accountEmail,
        accounts: providerCredentials.map((row) => ({
          accountEmail: row.accountEmail,
          displayName: row.displayName,
          id: row.id,
          providerAccountId: row.providerAccountId,
          providerWorkspaceId: row.providerWorkspaceId,
          providerWorkspaceName: row.providerWorkspaceName,
          status: row.status,
        })),
        connectedAt: credential?.createdAt,
        description: definition.description,
        displayName: definition.displayName,
        isConfigured,
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
  await db
    .delete(connectorOAuthState)
    .where(lt(connectorOAuthState.expiresAt, new Date()));

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
  const authorizationUrl = new URL(
    input.provider === LINEAR_CONNECTOR_PROVIDER
      ? LINEAR_AUTHORIZATION_URL
      : GOOGLE_AUTHORIZATION_URL
  );
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set(
    "code_challenge",
    createCodeChallenge(codeVerifier)
  );
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set(
    "scope",
    input.provider === LINEAR_CONNECTOR_PROVIDER
      ? definition.scopes.join(",")
      : definition.scopes.join(" ")
  );
  authorizationUrl.searchParams.set("state", state);
  if (input.provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("include_granted_scopes", "true");
    authorizationUrl.searchParams.set("prompt", "consent select_account");
  } else {
    authorizationUrl.searchParams.set("actor", "user");
    authorizationUrl.searchParams.set("prompt", "consent");
  }

  return { authorizationUrl: authorizationUrl.toString() };
};

export const completeConnectorOAuth = async (input: {
  code: string;
  headers: Headers;
  state: string;
}) => {
  const { auth } = await import("@quieter/auth");
  const session = await auth.api.getSession({ headers: input.headers });
  if (session?.user === undefined || session.session === undefined) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Sign in before connecting this account.",
    });
  }

  const [oauthState] = await db
    .delete(connectorOAuthState)
    .where(eq(connectorOAuthState.id, input.state))
    .returning();

  if (
    oauthState === undefined ||
    oauthState.userId !== session.user.id ||
    oauthState.expiresAt.getTime() <= Date.now()
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This connector request is invalid or expired.",
    });
  }

  const definition = connectorDefinitions[oauthState.provider];
  const now = new Date();

  if (oauthState.provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    const tokenResponse = await exchangeGoogleAuthorizationCode(
      oauthState.provider,
      input.code,
      oauthState.codeVerifier
    );
    const tokenInfo = await validateGoogleIdToken(
      oauthState.provider,
      tokenResponse.id_token
    );
    const grantedScopes = splitGrantedScopes(tokenResponse.scope);
    if (!definition.scopes.every((scope) => grantedScopes.has(scope))) {
      throw new Error(
        "Google did not grant all required connector permissions."
      );
    }

    const [existingCredential] = await db
      .select({
        encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
        id: connectorCredential.id,
        providerAccountId: connectorCredential.providerAccountId,
      })
      .from(connectorCredential)
      .where(
        and(
          eq(connectorCredential.userId, session.user.id),
          eq(connectorCredential.provider, oauthState.provider)
        )
      )
      .limit(1);
    if (
      existingCredential !== undefined &&
      existingCredential.providerAccountId !== tokenInfo.sub
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Reconnect ${connectorDefinitions[oauthState.provider].displayName} with the same Google account, or disconnect it first.`,
      });
    }

    const encryptedRefreshToken = hasText(tokenResponse.refresh_token)
      ? encryptConnectorSecret(tokenResponse.refresh_token)
      : existingCredential?.encryptedRefreshToken;
    if (!hasText(encryptedRefreshToken)) {
      throw new Error(
        "Google did not return an offline refresh token. Reconnect and grant access."
      );
    }

    await db
      .insert(connectorCredential)
      .values({
        accessTokenExpiresAt: new Date(
          now.getTime() + tokenResponse.expires_in * 1000
        ),
        accountEmail: tokenInfo.email,
        createdAt: now,
        displayName: tokenInfo.name ?? tokenInfo.email,
        encryptedAccessToken: encryptConnectorSecret(
          tokenResponse.access_token
        ),
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
          accessTokenExpiresAt: new Date(
            now.getTime() + tokenResponse.expires_in * 1000
          ),
          accountEmail: tokenInfo.email,
          displayName: tokenInfo.name ?? tokenInfo.email,
          encryptedAccessToken: encryptConnectorSecret(
            tokenResponse.access_token
          ),
          encryptedRefreshToken,
          providerAccountId: tokenInfo.sub,
          scopes: tokenResponse.scope,
          status: "connected",
          updatedAt: now,
        },
        target: [
          connectorCredential.userId,
          connectorCredential.provider,
          connectorCredential.providerAccountId,
        ],
      });
  } else {
    const tokenResponse = await exchangeLinearAuthorizationCode(
      input.code,
      oauthState.codeVerifier
    );
    const grantedScopes = splitGrantedScopes(tokenResponse.scope);
    if (!definition.scopes.every((scope) => grantedScopes.has(scope))) {
      throw new Error(
        "Linear did not grant all required connector permissions."
      );
    }
    if (!hasText(tokenResponse.refresh_token)) {
      throw new Error(
        "Linear did not return an offline refresh token. Reconnect and grant access."
      );
    }

    const identity = await getLinearIdentity(tokenResponse.access_token);
    const providerAccountId = `${identity.providerWorkspaceId}:${identity.providerAccountId}`;
    await db
      .insert(connectorCredential)
      .values({
        accessTokenExpiresAt: new Date(
          now.getTime() + tokenResponse.expires_in * 1000
        ),
        accountEmail: identity.accountEmail,
        createdAt: now,
        displayName: identity.displayName,
        encryptedAccessToken: encryptConnectorSecret(
          tokenResponse.access_token
        ),
        encryptedRefreshToken: encryptConnectorSecret(
          tokenResponse.refresh_token
        ),
        id: randomUUID(),
        metadata: {},
        provider: oauthState.provider,
        providerAccountId,
        providerWorkspaceId: identity.providerWorkspaceId,
        providerWorkspaceName: identity.providerWorkspaceName,
        scopes: normalizeOAuthScope(tokenResponse.scope),
        status: "connected",
        updatedAt: now,
        userId: session.user.id,
      })
      .onConflictDoUpdate({
        set: {
          accessTokenExpiresAt: new Date(
            now.getTime() + tokenResponse.expires_in * 1000
          ),
          accountEmail: identity.accountEmail,
          displayName: identity.displayName,
          encryptedAccessToken: encryptConnectorSecret(
            tokenResponse.access_token
          ),
          encryptedRefreshToken: encryptConnectorSecret(
            tokenResponse.refresh_token
          ),
          metadata: {},
          providerWorkspaceId: identity.providerWorkspaceId,
          providerWorkspaceName: identity.providerWorkspaceName,
          scopes: normalizeOAuthScope(tokenResponse.scope),
          status: "connected",
          updatedAt: now,
        },
        target: [
          connectorCredential.userId,
          connectorCredential.provider,
          connectorCredential.providerAccountId,
        ],
      });
  }

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
        eq(connectorCredential.provider, input.provider)
      )
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

const refreshConnectorAccessToken = async (record: {
  encryptedRefreshToken: string | null;
  id: string;
  provider: ConnectorProvider;
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
      scopes:
        refreshed.scope === undefined
          ? connectorDefinitions[record.provider].scopes.join(" ")
          : normalizeOAuthScope(refreshed.scope),
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

const getAuthorizedConnectorCredentialAccessToken = async (input: {
  credentialId: string;
  provider: ConnectorProvider;
  userId?: string;
}) => {
  const conditions = [
    eq(connectorCredential.id, input.credentialId),
    eq(connectorCredential.provider, input.provider),
  ];
  if (input.userId !== undefined) {
    conditions.push(eq(connectorCredential.userId, input.userId));
  }

  const [record] = await db
    .select({
      accessTokenExpiresAt: connectorCredential.accessTokenExpiresAt,
      encryptedAccessToken: connectorCredential.encryptedAccessToken,
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
      status: connectorCredential.status,
      userId: connectorCredential.userId,
    })
    .from(connectorCredential)
    .where(and(...conditions))
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
  const conditions = [
    eq(connectorCredential.id, input.credentialId),
    eq(connectorCredential.provider, input.provider),
  ];
  if (input.userId !== undefined) {
    conditions.push(eq(connectorCredential.userId, input.userId));
  }

  const [record] = await db
    .select({
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
    })
    .from(connectorCredential)
    .where(and(...conditions))
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  return await refreshConnectorAccessToken(record);
};

export const runAuthorizedConnector = async <TValue>(
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

export const runAuthorizedConnectorCredential = async <TValue>(
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
    }
  );

const decodeBase64UrlText = (value: string) =>
  Buffer.from(
    value.replaceAll("-", "+").replaceAll("_", "/"),
    "base64"
  ).toString("utf-8");

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
      await getMessageAttachment(
        accessToken,
        input.messageId,
        input.attachmentId,
        input.signal
      )
  );
  if (!hasText(attachment.data)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This calendar invitation could not be read.",
    });
  }

  const parsedEvent = (() => {
    try {
      return parseIcsToGoogleCalendarEvent(
        decodeBase64UrlText(attachment.data)
      );
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "This calendar invitation could not be imported.",
      });
    }
  })();
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
    }
  );

  return importedEvent;
};
