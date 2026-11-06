import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { connectorCredential } from "@quieter/database/schema";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";
import { connectorDisplayNames } from "./contracts";
import type { ConnectorProvider } from "./contracts";
import {
  ConnectorTokenError,
  oauthProviders,
  requestConnectorToken,
} from "./oauth-provider";

export { LINEAR_CONNECTOR_PROVIDER } from "./contracts";
export { LINEAR_SCOPES } from "./oauth-provider";
export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";

type ConnectorAuthorizationInput = {
  connectionId?: string;
  provider: ConnectorProvider;
  signal?: AbortSignal;
  userId: string;
  mutates?: boolean;
};

export const encryptConnectorSecret = (value: string) =>
  encryptGmailCredentialSecret(value, {
    legacyKey: requireServerEnv("CONNECTOR_TOKEN_ENCRYPTION_KEY"),
  });
const decryptConnectorSecret = (value: string) =>
  decryptGmailCredentialSecret(value, {
    legacyKey: requireServerEnv("CONNECTOR_TOKEN_ENCRYPTION_KEY"),
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

export const hasRequiredConnectorScopes = (
  provider: ConnectorProvider,
  scopes: string
) => {
  const granted = new Set(
    scopes
      .split(/[\s,]+/u)
      .filter(Boolean)
      .map((scope) =>
        scope.replace(/^https:\/\/graph\.microsoft\.com\//u, "").toLowerCase()
      )
  );
  return oauthProviders[provider].scopes.every((scope) =>
    granted.has(scope.toLowerCase())
  );
};

export const hasConnectedConnector = async (input: {
  provider: ConnectorProvider;
  userId: string;
}) => {
  const records = await db
    .select({ scopes: connectorCredential.scopes })
    .from(connectorCredential)
    .where(
      and(
        eq(connectorCredential.userId, input.userId),
        eq(connectorCredential.provider, input.provider),
        eq(connectorCredential.status, "connected")
      )
    );
  return records.some((record) =>
    hasRequiredConnectorScopes(input.provider, record.scopes)
  );
};

export const getConnectorConnectionForUser = async (input: {
  provider: ConnectorProvider;
  userId: string;
  connectionId?: string;
}) => {
  const records = await db
    .select({
      account: connectorCredential.accountEmail,
      connectionId: connectorCredential.id,
      displayName: connectorCredential.displayName,
      providerAccountId: connectorCredential.providerAccountId,
      workspace: connectorCredential.providerWorkspaceName,
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
    .limit(2);
  const [record] = records;
  if (record === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDisplayNames[input.provider]} before using this action.`,
    });
  }
  if (records.length > 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose the account to use for this action.",
    });
  }
  return {
    ...record,
    account: record.account ?? record.displayName ?? record.providerAccountId,
  };
};

export const getLinearConnectionForUser = async (userId: string) => {
  const { account, connectionId, workspace } =
    await getConnectorConnectionForUser({ provider: "linear", userId });
  return { account, connectionId, workspace };
};

const getConnectorRepairRequiredError = (provider: ConnectorProvider) =>
  new ORPCError("BAD_REQUEST", {
    message: `Reconnect ${connectorDisplayNames[provider]} before using this action.`,
  });

const getAuthorizedConnectorToken = async (
  input: ConnectorAuthorizationInput,
  rejectedToken?: string
) => {
  input.signal?.throwIfAborted();
  const records = await db
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
    .limit(2);
  const [current] = records;
  if (current === undefined || current.provider !== input.provider) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDisplayNames[input.provider]} before using this action.`,
    });
  }
  if (records.length > 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose the account to use for this action.",
    });
  }
  if (
    current.status !== "connected" ||
    !hasRequiredConnectorScopes(input.provider, current.scopes)
  ) {
    throw getConnectorRepairRequiredError(input.provider);
  }
  if (current.encryptedAccessToken !== null) {
    const cached = decryptConnectorSecret(current.encryptedAccessToken);
    if (
      cached !== rejectedToken &&
      (current.accessTokenExpiresAt === null ||
        current.accessTokenExpiresAt.getTime() > Date.now() + 60_000)
    ) {
      return {
        accessToken: cached,
        encryptedAccessToken: current.encryptedAccessToken,
      };
    }
  }
  // The row lock serializes rotating refresh tokens across requests and workers.
  const result = await db.transaction(async (transaction) => {
    const [record] = await transaction
      .select()
      .from(connectorCredential)
      .where(
        and(
          eq(connectorCredential.id, current.id),
          eq(connectorCredential.userId, input.userId),
          eq(connectorCredential.provider, input.provider)
        )
      )
      .for("update");
    if (record === undefined) {
      return { error: true } as const;
    }
    if (
      record.status !== "connected" ||
      !hasRequiredConnectorScopes(input.provider, record.scopes)
    ) {
      return { error: true } as const;
    }
    const cached =
      record.encryptedAccessToken === null
        ? null
        : decryptConnectorSecret(record.encryptedAccessToken);
    if (
      cached !== null &&
      cached !== rejectedToken &&
      (record.accessTokenExpiresAt === null ||
        record.accessTokenExpiresAt.getTime() > Date.now() + 60_000)
    ) {
      return {
        accessToken: cached,
        encryptedAccessToken: record.encryptedAccessToken,
      };
    }
    if (record.encryptedRefreshToken === null) {
      await transaction
        .update(connectorCredential)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(connectorCredential.id, record.id));
      return { error: true } as const;
    }
    let refreshed;
    try {
      refreshed = await requestConnectorToken(
        input.provider,
        { refreshToken: decryptConnectorSecret(record.encryptedRefreshToken) },
        input.signal
      );
    } catch (error) {
      if (!(error instanceof ConnectorTokenError) || !error.permanent) {
        throw error;
      }
      await transaction
        .update(connectorCredential)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(connectorCredential.id, record.id));
      return { error: true } as const;
    }
    const { token } = refreshed;
    const scopes =
      token.scope === undefined
        ? record.scopes
        : normalizeOAuthScope(token.scope);
    const valid = hasRequiredConnectorScopes(input.provider, scopes);
    const encryptedAccessToken = encryptConnectorSecret(token.access_token);
    await transaction
      .update(connectorCredential)
      .set({
        accessTokenExpiresAt:
          token.expires_in === undefined
            ? null
            : new Date(Date.now() + token.expires_in * 1000),
        encryptedAccessToken,
        encryptedRefreshToken:
          token.refresh_token === undefined
            ? record.encryptedRefreshToken
            : encryptConnectorSecret(token.refresh_token),
        scopes,
        status: valid ? "connected" : "needs_reconnect",
        updatedAt: new Date(),
      })
      .where(eq(connectorCredential.id, record.id));
    return valid
      ? { accessToken: token.access_token, encryptedAccessToken }
      : ({ error: true } as const);
  });
  if ("error" in result) {
    throw getConnectorRepairRequiredError(input.provider);
  }
  return result;
};

export const runAuthorizedConnector = async <Result>(
  input: ConnectorAuthorizationInput,
  run: (accessToken: string, signal?: AbortSignal) => Promise<Result>
): Promise<Result> => {
  const connection = await getConnectorConnectionForUser(input);
  if (input.mutates === true && serverEnv.QUIETER_DEPLOYMENT_ENV === "local") {
    const allowed = new Set(
      (serverEnv.QUIETER_LOCAL_CONNECTOR_WRITE_ACCOUNTS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
    if (
      serverEnv.QUIETER_LOCAL_PROVIDER_MODE !== "write" ||
      !allowed.has(`${input.provider}:${connection.providerAccountId}`)
    ) {
      throw new ORPCError("FORBIDDEN", {
        message: "Local changes require an explicitly allowed test account.",
      });
    }
  }
  const authorization = { ...input, connectionId: connection.connectionId };
  let token = await getAuthorizedConnectorToken(authorization);
  try {
    return await run(token.accessToken, input.signal);
  } catch (error) {
    if (!(error instanceof ConnectorHttpError) || error.status !== 401) {
      throw error;
    }
    if (input.mutates !== true) {
      token = await getAuthorizedConnectorToken(
        authorization,
        token.accessToken
      );
      try {
        return await run(token.accessToken, input.signal);
      } catch (retryError) {
        if (
          !(retryError instanceof ConnectorHttpError) ||
          retryError.status !== 401
        ) {
          throw retryError;
        }
      }
    }
    if (token.encryptedAccessToken !== null) {
      await db
        .update(connectorCredential)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(
          and(
            eq(connectorCredential.id, connection.connectionId),
            eq(connectorCredential.userId, input.userId),
            eq(connectorCredential.provider, input.provider),
            eq(
              connectorCredential.encryptedAccessToken,
              token.encryptedAccessToken
            )
          )
        );
    }
    throw getConnectorRepairRequiredError(input.provider);
  }
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

export const getLinearAccessTokenForUser = async (input: {
  connectionId?: string;
  userId: string;
  signal?: AbortSignal;
}) => {
  const token = await getAuthorizedConnectorToken({
    ...input,
    provider: "linear",
  });
  return token.accessToken;
};
