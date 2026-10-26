import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  connectorCredential,
  connectorOAuthState,
} from "@quieter/database/schema";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";

import { CONNECTOR_PROVIDERS } from "./contracts";
import type { ConnectorProvider } from "./contracts";
import {
  encryptConnectorSecret,
  getLinearOAuthClient,
  normalizeOAuthScope,
  hasRequiredConnectorScopes,
  getLinearIdentityFromAccessToken,
  LINEAR_AUTHORIZATION_URL,
  LINEAR_CONNECTOR_PROVIDER,
  LINEAR_SCOPES,
  LINEAR_TOKEN_URL,
} from "./runtime";

export {
  hasConnectedConnector,
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

const linearTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.union([z.string(), z.array(z.string())]),
  token_type: z.string().min(1),
});

const connectorDefinitions = {
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
    normalized === undefined ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    // oxlint-disable-next-line eslint/no-control-regex -- Reject controls before URL normalization can discard them.
    /[\\\u0000-\u001F\u007F]/u.test(returnTo ?? "")
  ) {
    return "/settings";
  }
  const origin = "https://quieter.invalid";
  const returnUrl = new URL(normalized, origin);
  if (returnUrl.origin !== origin || returnUrl.pathname.startsWith("//")) {
    return "/settings";
  }
  return `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
};

const createCodeVerifier = () => randomBytes(48).toString("base64url");
const createCodeChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const isLinearClientConfigured = () =>
  !!serverEnv.LINEAR_CLIENT_ID &&
  !!serverEnv.LINEAR_CLIENT_SECRET &&
  !!serverEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY;

const isLinearOAuthConfigured = () =>
  !!serverEnv.BETTER_AUTH_URL && isLinearClientConfigured();

const assertConnectorConfigured = (provider: ConnectorProvider) => {
  if (provider === LINEAR_CONNECTOR_PROVIDER && isLinearOAuthConfigured()) {
    return;
  }

  throw new ORPCError("BAD_REQUEST", {
    message: `${connectorDefinitions[provider].displayName} connection is not configured for this environment.`,
  });
};

const getConnectorOAuthConfig = (provider: ConnectorProvider) => {
  assertConnectorConfigured(provider);

  const baseUrl = requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "");
  return {
    ...getLinearOAuthClient(),
    redirectUri: `${baseUrl}/api/connectors/callback`,
  };
};

const splitGrantedScopes = (scope: string | string[]) =>
  new Set(
    normalizeOAuthScope(scope)
      .split(/[\s,]+/u)
      .filter(Boolean)
  );

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
      scopes: connectorCredential.scopes,
      status: connectorCredential.status,
    })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, userId),
        eq(connectorCredential.provider, LINEAR_CONNECTOR_PROVIDER)
      )
    );

  return {
    connectors: CONNECTOR_PROVIDERS.map((provider) => {
      const providerCredentials = credentials.filter(
        (row) => row.provider === provider
      );
      const [credential] = providerCredentials;
      const definition = connectorDefinitions[provider];
      const isConfigured = isLinearOAuthConfigured();
      let status: ConnectorConnectionStatus = "not_connected";
      if (credential !== undefined) {
        status =
          credential.status === "connected" &&
          hasRequiredConnectorScopes(provider, credential.scopes ?? "")
            ? "connected"
            : "needs_reconnect";
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
          status:
            row.status === "connected" &&
            hasRequiredConnectorScopes(provider, row.scopes ?? "")
              ? "connected"
              : "needs_reconnect",
        })),
        connectedAt: credential?.createdAt,
        description: definition.description,
        displayName: definition.displayName,
        isConfigured,
        provider,
        status,
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
  const authorizationUrl = new URL(LINEAR_AUTHORIZATION_URL);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set(
    "code_challenge",
    createCodeChallenge(codeVerifier)
  );
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", definition.scopes.join(","));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("actor", "user");
  authorizationUrl.searchParams.set("prompt", "consent");

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
    .where(
      and(
        eq(connectorOAuthState.id, input.state),
        eq(connectorOAuthState.userId, session.user.id),
        gt(connectorOAuthState.expiresAt, new Date())
      )
    )
    .returning();

  if (
    oauthState === undefined ||
    oauthState.provider !== LINEAR_CONNECTOR_PROVIDER ||
    oauthState.userId !== session.user.id ||
    oauthState.expiresAt.getTime() <= Date.now()
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This connector request is invalid or expired.",
    });
  }

  const definition = connectorDefinitions[oauthState.provider];
  const now = new Date();

  const tokenResponse = await exchangeLinearAuthorizationCode(
    input.code,
    oauthState.codeVerifier
  );
  const grantedScopes = splitGrantedScopes(tokenResponse.scope);
  if (!definition.scopes.every((scope) => grantedScopes.has(scope))) {
    throw new Error("Linear did not grant all required connector permissions.");
  }
  if (!tokenResponse.refresh_token) {
    throw new Error(
      "Linear did not return an offline refresh token. Reconnect and grant access."
    );
  }

  const identity = await getLinearIdentityFromAccessToken(
    tokenResponse.access_token
  );
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
      encryptedAccessToken: encryptConnectorSecret(tokenResponse.access_token),
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
  return {
    provider: oauthState.provider,
    returnTo: normalizeReturnTo(oauthState.returnTo),
  };
};

export const disconnectConnector = async (input: {
  connectionId?: string;
  provider: ConnectorProvider;
  userId: string;
}) => {
  const [deleted] = await db
    .delete(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider),
        input.connectionId === undefined
          ? undefined
          : eq(connectorCredential.id, input.connectionId)
      )
    )
    .returning({ id: connectorCredential.id });

  return { disconnected: Boolean(deleted), provider: input.provider };
};
