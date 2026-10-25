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
export const LINEAR_AUTHORIZATION_URL = "https://linear.app/oauth/authorize";
export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const permanentGoogleTokenErrors = new Set(["invalid_grant", "invalid_token"]);
const permanentLinearTokenErrors = new Set(["invalid_grant", "invalid_token"]);
type ConnectorAuthorizationInput = {
  retryUnauthorized?: boolean;
  signal?: AbortSignal;
  userId: string;
} & (
  | {
      connectionId: string;
      provider: typeof GOOGLE_CALENDAR_CONNECTOR_PROVIDER;
    }
  | { connectionId?: string; provider: typeof LINEAR_CONNECTOR_PROVIDER }
);

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
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

const getGoogleCalendarOAuthClient = () => ({
  clientId: requireServerEnv("GOOGLE_CALENDAR_CLIENT_ID"),
  clientSecret: requireServerEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
});

const getLinearOAuthClient = () => ({
  clientId: requireServerEnv("LINEAR_CLIENT_ID"),
  clientSecret: requireServerEnv("LINEAR_CLIENT_SECRET"),
});

export const getConnectorOAuthClient = (provider: ConnectorProvider) => {
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

export const encryptConnectorSecret = (value: string) =>
  encryptGmailCredentialSecret(value, {
    legacyKey: getConnectorCredentialEncryptionKey(),
  });

const decryptConnectorSecret = (value: string) =>
  decryptGmailCredentialSecret(value, {
    legacyKey: getConnectorCredentialEncryptionKey(),
  });

export const normalizeOAuthScope = (scope: string | string[]) =>
  Array.isArray(scope) ? scope.join(" ") : scope;

export class ConnectorHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ConnectorHttpError";
    this.status = status;
  }
}

const hasCachedConnectorAccessToken = (record: {
  accessTokenExpiresAt: Date | null;
  encryptedAccessToken: string | null;
}): record is {
  accessTokenExpiresAt: Date;
  encryptedAccessToken: string;
} =>
  !!record.encryptedAccessToken &&
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
  new ORPCError(
    provider === "google_calendar" ? "UNAUTHORIZED" : "BAD_REQUEST",
    {
      message: `Reconnect ${connectorDefinitions[provider].displayName} before using this action.`,
    }
  );

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
export const hasRequiredConnectorScopes = (
  provider: ConnectorProvider,
  scopes: string
) => {
  const granted = new Set(
    scopes.split(/[\s,]+/u).filter((value) => value !== "")
  );
  return connectorDefinitions[provider].scopes.every((scope) =>
    granted.has(scope)
  );
};

const refreshConnectorAccessToken = async (
  record: {
    encryptedRefreshToken: string | null;
    id: string;
    provider: ConnectorProvider;
    scopes: string | null;
  },
  signal?: AbortSignal
) => {
  signal?.throwIfAborted();
  if (!record.encryptedRefreshToken) {
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
      signal:
        signal === undefined
          ? AbortSignal.timeout(15_000)
          : AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
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
  const hasRequiredScopes = hasRequiredConnectorScopes(record.provider, scopes);
  await db
    .update(connectorCredential)
    .set({
      accessTokenExpiresAt: new Date(
        now.getTime() + refreshed.expires_in * 1000
      ),
      encryptedAccessToken: encryptConnectorSecret(refreshed.access_token),
      encryptedRefreshToken:
        "refresh_token" in refreshed && refreshed.refresh_token
          ? encryptConnectorSecret(refreshed.refresh_token)
          : record.encryptedRefreshToken,
      scopes,
      // An older, narrower grant still refreshes, but it cannot do what the connector
      // now asks of it, so it is surfaced as needing a reconnect rather than silently
      // failing at the first call that needs the missing scope.
      status: hasRequiredScopes ? "connected" : "needs_reconnect",
      updatedAt: now,
    })
    .where(eq(connectorCredential.id, record.id));

  if (!hasRequiredScopes) {
    throw getConnectorRepairRequiredError(record.provider);
  }
  return refreshed.access_token;
};

const getAuthorizedConnectorAccessToken = async (
  input: ConnectorAuthorizationInput
) => {
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
        eq(connectorCredential.provider, input.provider),
        input.connectionId === undefined
          ? undefined
          : eq(connectorCredential.id, input.connectionId)
      )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  input.signal?.throwIfAborted();
  if (
    record.status === "needs_reconnect" ||
    !hasRequiredConnectorScopes(record.provider, record.scopes ?? "")
  ) {
    throw getConnectorRepairRequiredError(record.provider);
  }

  if (hasCachedConnectorAccessToken(record)) {
    return decryptConnectorSecret(record.encryptedAccessToken);
  }

  return await refreshConnectorAccessToken(record, input.signal);
};

const refreshAuthorizedConnectorAccessToken = async (
  input: ConnectorAuthorizationInput
) => {
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
        eq(connectorCredential.provider, input.provider),
        input.connectionId === undefined
          ? undefined
          : eq(connectorCredential.id, input.connectionId)
      )
    )
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  return await refreshConnectorAccessToken(record, input.signal);
};

export const runAuthorizedConnector = async <TValue>(
  input: ConnectorAuthorizationInput,
  runner: (
    accessToken: string,
    signal?: AbortSignal
  ) => TValue | Promise<TValue>
) => {
  const accessToken = await getAuthorizedConnectorAccessToken(input);

  try {
    return await runner(accessToken, input.signal);
  } catch (error) {
    if (
      input.retryUnauthorized === false ||
      !(error instanceof ConnectorHttpError) ||
      error.status !== 401
    ) {
      throw error;
    }
  }

  const refreshedAccessToken =
    await refreshAuthorizedConnectorAccessToken(input);
  return await runner(refreshedAccessToken, input.signal);
};

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
  if (viewer.displayName) {
    return viewer.displayName;
  }
  if (viewer.name) {
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
export const getLinearAccessTokenForUser = async (input: {
  connectionId?: string;
  userId: string;
  signal?: AbortSignal;
}) =>
  await getAuthorizedConnectorAccessToken({
    connectionId: input.connectionId,
    provider: LINEAR_CONNECTOR_PROVIDER,
    signal: input.signal,
    userId: input.userId,
  });
