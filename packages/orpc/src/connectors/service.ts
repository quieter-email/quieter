import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  connectorCredential,
  connectorOAuthState,
} from "@quieter/database/schema";
import { requireServerEnv } from "@quieter/env/server";
import { and, eq, gt, lt } from "drizzle-orm";

import { pausePersonalAgentConnections } from "../mail-agent/authority";
import {
  CONNECTOR_PROVIDERS,
  connectorDisplayNames,
  connectorProviderSchema,
} from "./contracts";
import type { ConnectorProvider } from "./contracts";
import {
  getConnectorOAuthClient,
  getOAuthConnectorIdentity,
  isConnectorOAuthConfigured,
  oauthProviders,
  requestConnectorToken,
} from "./oauth-provider";
import {
  encryptConnectorSecret,
  getConnectorConnectionForUser,
  getLinearIdentityFromAccessToken,
  hasRequiredConnectorScopes,
  normalizeOAuthScope,
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

const assertConnectorConfigured = (provider: ConnectorProvider) => {
  if (!isConnectorOAuthConfigured(provider)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${connectorDisplayNames[provider]} connection is not configured for this environment.`,
    });
  }
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
    .where(eq(connectorCredential.userId, userId));
  return {
    connectors: CONNECTOR_PROVIDERS.map((provider) => {
      const accounts = credentials
        .filter((row) => row.provider === provider)
        .map((row) => ({
          accountEmail: row.accountEmail,
          displayName: row.displayName,
          id: row.id,
          providerAccountId: row.providerAccountId,
          providerWorkspaceId: row.providerWorkspaceId,
          providerWorkspaceName: row.providerWorkspaceName,
          status:
            row.status === "connected" &&
            hasRequiredConnectorScopes(provider, row.scopes)
              ? ("connected" as const)
              : ("needs_reconnect" as const),
        }));
      const credential = credentials.find((row) => row.provider === provider);
      let status: ConnectorConnectionStatus = "not_connected";
      if (accounts.length > 0) {
        status = accounts.some((account) => account.status === "connected")
          ? "connected"
          : "needs_reconnect";
      }
      return {
        accountEmail: credential?.accountEmail,
        accounts,
        connectedAt: credential?.createdAt,
        description: oauthProviders[provider].description,
        displayName: connectorDisplayNames[provider],
        isConfigured: isConnectorOAuthConfigured(provider),
        provider,
        status,
        supportsChatTools: true,
      };
    }),
  };
};

export const startConnectorOAuth = async (input: {
  connectionId?: string;
  headers: Headers;
  provider: ConnectorProvider;
  returnTo?: string;
  userId: string;
}) => {
  assertConnectorConfigured(input.provider);
  const { auth } = await import("@quieter/auth");
  const session = await auth.api.getSession({ headers: input.headers });
  if (session?.user.id !== input.userId || session.session === undefined) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (input.connectionId !== undefined) {
    await getConnectorConnectionForUser(input);
  }
  await db
    .delete(connectorOAuthState)
    .where(lt(connectorOAuthState.expiresAt, new Date()));
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const now = new Date();
  await db.insert(connectorOAuthState).values({
    codeVerifier,
    connectionId: input.connectionId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    id: createHash("sha256").update(state).digest("hex"),
    provider: input.provider,
    returnTo: normalizeReturnTo(input.returnTo),
    sessionHash: createHash("sha256").update(session.session.id).digest("hex"),
    userId: input.userId,
  });
  const config = getConnectorOAuthClient(input.provider);
  const definition = oauthProviders[input.provider];
  const authorizationUrl = new URL(definition.authorizationUrl);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    `${requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "")}/api/connectors/callback`
  );
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);
  if (definition.pkce) {
    authorizationUrl.searchParams.set(
      "code_challenge",
      createHash("sha256").update(codeVerifier).digest("base64url")
    );
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
  }
  if (definition.scopes.length > 0) {
    authorizationUrl.searchParams.set(
      "scope",
      input.provider.startsWith("microsoft_")
        ? [...definition.scopes, "offline_access"].join(" ")
        : definition.scopes.join(",")
    );
  }
  if (input.provider === "linear") {
    authorizationUrl.searchParams.set("actor", "user");
    authorizationUrl.searchParams.set("prompt", "consent");
  }
  if (input.provider === "notion") {
    authorizationUrl.searchParams.set("owner", "user");
  }
  if (input.provider.startsWith("microsoft_")) {
    authorizationUrl.searchParams.set("prompt", "select_account");
    authorizationUrl.searchParams.set("response_mode", "query");
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
  if (!session?.user || session.session === undefined) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Sign in before connecting this account.",
    });
  }
  const [oauthState] = await db
    .delete(connectorOAuthState)
    .where(
      and(
        eq(
          connectorOAuthState.id,
          createHash("sha256").update(input.state).digest("hex")
        ),
        eq(connectorOAuthState.userId, session.user.id),
        eq(
          connectorOAuthState.sessionHash,
          createHash("sha256").update(session.session.id).digest("hex")
        ),
        gt(connectorOAuthState.expiresAt, new Date())
      )
    )
    .returning();
  const parsedProvider = connectorProviderSchema.safeParse(
    oauthState?.provider
  );
  if (oauthState === undefined || !parsedProvider.success) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This connector request is invalid or expired.",
    });
  }
  const provider = parsedProvider.data;
  const { token, body } = await requestConnectorToken(provider, {
    code: input.code,
    codeVerifier: oauthState.codeVerifier,
  });
  const scopes =
    token.scope === undefined &&
    provider !== "linear" &&
    !provider.startsWith("microsoft_")
      ? oauthProviders[provider].scopes.join(" ")
      : normalizeOAuthScope(token.scope ?? "");
  if (
    !hasRequiredConnectorScopes(provider, scopes) ||
    ((provider === "linear" || provider.startsWith("microsoft_")) &&
      (!token.refresh_token || token.expires_in === undefined))
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Reconnect ${connectorDisplayNames[provider]} and grant the requested access.`,
    });
  }
  const identity =
    provider === "linear"
      ? await getLinearIdentityFromAccessToken(token.access_token)
      : await getOAuthConnectorIdentity(provider, token.access_token, body);
  const providerAccountId =
    provider === "linear"
      ? `${identity.providerWorkspaceId}:${identity.providerAccountId}`
      : identity.providerAccountId;
  const now = new Date();
  const values = {
    accessTokenExpiresAt:
      token.expires_in === undefined
        ? null
        : new Date(now.getTime() + token.expires_in * 1000),
    accountEmail: identity.accountEmail,
    displayName: identity.displayName,
    encryptedAccessToken: encryptConnectorSecret(token.access_token),
    encryptedRefreshToken:
      token.refresh_token === undefined
        ? null
        : encryptConnectorSecret(token.refresh_token),
    metadata: {},
    providerWorkspaceId: identity.providerWorkspaceId,
    providerWorkspaceName: identity.providerWorkspaceName,
    scopes,
    status: "connected" as const,
    updatedAt: now,
  };
  if (oauthState.connectionId === null) {
    await db
      .insert(connectorCredential)
      .values({
        ...values,
        createdAt: now,
        id: randomUUID(),
        provider,
        providerAccountId,
        userId: session.user.id,
      })
      .onConflictDoUpdate({
        set: values,
        target: [
          connectorCredential.userId,
          connectorCredential.provider,
          connectorCredential.providerAccountId,
        ],
      });
  } else {
    const [updated] = await db
      .update(connectorCredential)
      .set(values)
      .where(
        and(
          eq(connectorCredential.id, oauthState.connectionId),
          eq(connectorCredential.userId, session.user.id),
          eq(connectorCredential.provider, provider),
          eq(connectorCredential.providerAccountId, providerAccountId)
        )
      )
      .returning({ id: connectorCredential.id });
    if (updated === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose the same account when reconnecting.",
      });
    }
  }
  return { provider, returnTo: normalizeReturnTo(oauthState.returnTo) };
};

export const disconnectConnector = async (input: {
  connectionId?: string;
  provider: ConnectorProvider;
  userId: string;
}) => {
  const deleted = await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: connectorCredential.id })
      .from(connectorCredential)
      .where(
        and(
          eq(connectorCredential.userId, input.userId),
          eq(connectorCredential.provider, input.provider),
          input.connectionId === undefined
            ? undefined
            : eq(connectorCredential.id, input.connectionId)
        )
      );
    await pausePersonalAgentConnections(
      {
        connectionIds: owned.map((connection) => connection.id),
        userId: input.userId,
      },
      tx
    );
    return await tx
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
  });
  return { disconnected: deleted.length > 0, provider: input.provider };
};
