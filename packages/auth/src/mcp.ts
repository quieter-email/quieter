import { db } from "@quieter/database/client";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  session,
  user,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { MCP_API_PATH } from "@quieter/mail/public-api";
import { and, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";

export const MCP_ACCOUNT_SCOPE = "quieter:account";
export const MCP_OFFLINE_SCOPE = "offline_access";
export const MCP_ACCESS_TOKEN_PREFIX = "qat_";

export type McpAccount = {
  clientId: string;
  email: string;
  id: string;
  name: string;
};

export type McpConnection = {
  clientId: string;
  connectedAt: Date;
  name: string;
};

const MCP_ACCESS_TOKEN_PATTERN = new RegExp(
  `^Bearer +${MCP_ACCESS_TOKEN_PREFIX}(?<token>[A-Za-z]{32})$`,
  "iu"
);

export const mcpAuthBaseUrl = () =>
  new URL(serverEnv.BETTER_AUTH_URL ?? "http://localhost:3000").origin;

/** The one protected resource that MCP access tokens are issued for. */
export const mcpResourceUrl = () => `${mcpAuthBaseUrl()}${MCP_API_PATH}`;

export const mcpResourceMetadataUrl = () =>
  `${mcpAuthBaseUrl()}/.well-known/oauth-protected-resource${MCP_API_PATH}`;

export const hashMcpToken = async (token: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Buffer.from(digest).toString("base64url");
};

/**
 * Resolves the account behind an MCP access token. Reads the token, client,
 * session, and user on every call, so revocation takes effect immediately.
 */
export const getMcpAccount = async (
  request: Request
): Promise<McpAccount | null> => {
  const token = MCP_ACCESS_TOKEN_PATTERN.exec(
    request.headers.get("authorization") ?? ""
  )?.groups?.token;
  if (token === undefined) {
    return null;
  }

  const now = new Date();
  const [grant] = await db
    .select({
      clientId: oauthAccessToken.clientId,
      email: user.email,
      id: user.id,
      name: user.name,
      resources: oauthAccessToken.resources,
      scopes: oauthAccessToken.scopes,
    })
    .from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
    .innerJoin(user, eq(user.id, oauthAccessToken.userId))
    // Disconnecting removes consent, which also ends a grant that an in-flight
    // code exchange or refresh re-creates afterwards.
    .innerJoin(
      oauthConsent,
      and(
        eq(oauthConsent.clientId, oauthAccessToken.clientId),
        eq(oauthConsent.userId, oauthAccessToken.userId)
      )
    )
    .leftJoin(session, eq(session.id, oauthAccessToken.sessionId))
    .where(
      and(
        eq(oauthAccessToken.token, await hashMcpToken(token)),
        gt(oauthAccessToken.expiresAt, now),
        isNull(oauthAccessToken.revoked),
        // Sender-constrained tokens are never valid as plain bearer tokens.
        isNull(oauthAccessToken.confirmation),
        or(isNull(oauthAccessToken.sessionId), gt(session.expiresAt, now)),
        or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false)),
        isNotNull(user.termsAcceptedAt),
        isNotNull(user.onboardingCompletedAt)
      )
    )
    .limit(1);

  if (
    grant?.resources?.length !== 1 ||
    grant.resources[0] !== mcpResourceUrl() ||
    !grant.scopes.includes(MCP_ACCOUNT_SCOPE)
  ) {
    return null;
  }

  return {
    clientId: grant.clientId,
    email: grant.email,
    id: grant.id,
    name: grant.name,
  };
};

export const listMcpConnections = async (
  userId: string
): Promise<McpConnection[]> => {
  const connections = await db
    .select({
      clientId: oauthConsent.clientId,
      connectedAt: oauthConsent.createdAt,
      name: oauthClient.name,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt));

  return connections.map((connection) => ({
    ...connection,
    name: connection.name?.trim() || "Unnamed app",
  }));
};

export const disconnectMcpClient = async ({
  clientId,
  userId,
}: {
  clientId: string;
  userId: string;
}) => {
  await db.transaction(async (transaction) => {
    const [consent] = await transaction
      .delete(oauthConsent)
      .where(
        and(
          eq(oauthConsent.clientId, clientId),
          eq(oauthConsent.userId, userId)
        )
      )
      .returning({ clientId: oauthConsent.clientId });
    if (consent !== undefined) {
      await transaction
        .update(oauthClient)
        .set({ updatedAt: new Date() })
        .where(eq(oauthClient.clientId, consent.clientId));
    }
    await transaction
      .delete(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.clientId, clientId),
          eq(oauthRefreshToken.userId, userId)
        )
      );
    await transaction
      .delete(oauthAccessToken)
      .where(
        and(
          eq(oauthAccessToken.clientId, clientId),
          eq(oauthAccessToken.userId, userId)
        )
      );
  });
};
