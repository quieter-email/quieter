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

import { runAuthorizedGmailMailbox } from "../gmail-mailbox-access";
import { assertAccessibleMailbox } from "../mailbox/service";
import { getManagedMessageAttachment } from "../managed-mail/messages/attachments";
import { hasText } from "../text";
import {
  CONNECTOR_PROVIDERS,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
} from "./contracts";
import { parseIcsToGoogleCalendarEvent } from "./ical";
import {
  encryptConnectorSecret,
  getConnectorOAuthClient,
  GOOGLE_CALENDAR_SCOPES,
  normalizeOAuthScope,
  postGoogleCalendarEvent,
  runAuthorizedConnector,
  getLinearIdentityFromAccessToken,
  LINEAR_AUTHORIZATION_URL,
  LINEAR_CONNECTOR_PROVIDER,
  LINEAR_SCOPES,
  LINEAR_TOKEN_URL,
} from "./runtime";

export {
  GOOGLE_CALENDAR_SCOPES,
  getLinearMcpEndpoint,
  hasConnectedConnector,
  createGoogleCalendarEventForUser,
  LINEAR_CONNECTOR_PROVIDER,
  LINEAR_SCOPES,
} from "./runtime";

export {
  CONNECTOR_PROVIDERS,
  connectorProviderSchema,
  GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
} from "./contracts";

export type ConnectorConnectionStatus =
  | "connected"
  | "needs_reconnect"
  | "not_connected";

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

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().min(1),
  token_type: z.string().min(1),
});

const linearTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.union([z.string(), z.array(z.string())]),
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

const getConnectorOAuthConfig = (provider: ConnectorProvider) => {
  assertConnectorConfigured(provider);

  if (provider === GOOGLE_CALENDAR_CONNECTOR_PROVIDER) {
    const baseUrl = requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "");
    return {
      ...getConnectorOAuthClient(GOOGLE_CALENDAR_CONNECTOR_PROVIDER),
      redirectUri: `${baseUrl}/api/connectors/callback`,
    };
  }
  if (provider === LINEAR_CONNECTOR_PROVIDER) {
    const baseUrl = requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "");
    return {
      ...getConnectorOAuthClient(LINEAR_CONNECTOR_PROVIDER),
      redirectUri: `${baseUrl}/api/connectors/callback`,
    };
  }

  throw new ORPCError("BAD_REQUEST", {
    message: "Connector is not supported.",
  });
};

const splitGrantedScopes = (scope: string | string[]) =>
  new Set(
    normalizeOAuthScope(scope)
      .split(/[\s,]+/u)
      .filter(Boolean)
  );

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

export const addIcsAttachmentToGoogleCalendar = async (input: {
  attachmentId: string;
  mailboxId: string;
  messageId: string;
  signal?: AbortSignal;
  userId: string;
}) => {
  const mailbox = await assertAccessibleMailbox(input);
  let invitation: string;
  if (mailbox.provider === "managed") {
    const attachment = await getManagedMessageAttachment(input);
    invitation = await attachment.file.text();
  } else {
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
    invitation = Buffer.from(attachment.data ?? "", "base64url").toString(
      "utf-8"
    );
  }
  if (invitation.trim() === "") {
    throw new ORPCError("BAD_REQUEST", {
      message: "This calendar invitation could not be read.",
    });
  }

  const parsedEvent = (() => {
    try {
      return parseIcsToGoogleCalendarEvent(invitation);
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
