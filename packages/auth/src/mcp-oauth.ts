import {
  oauthProvider,
  verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import { db } from "@quieter/database/client";
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  tables,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { and, eq, inArray, isNull, lt, notExists, or } from "drizzle-orm";
import { z } from "zod";

import {
  disconnectMcpClient,
  hashMcpToken,
  listMcpConnections,
  MCP_ACCESS_TOKEN_PREFIX,
  MCP_ACCOUNT_SCOPE,
  MCP_OFFLINE_SCOPE,
  mcpAuthBaseUrl,
  mcpResourceUrl,
} from "./mcp";

export const MCP_LOGIN_PATH = "/oauth/login";
export const MCP_CONSENT_PATH = "/oauth/consent";

const AUTH_BASE_PATH = "/api/auth";
const OAUTH_BASE_PATH = `${AUTH_BASE_PATH}/oauth2`;
const AUTHORIZATION_SERVER_METADATA_PATH = `/.well-known/oauth-authorization-server${AUTH_BASE_PATH}`;
const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";
const SCOPES = [MCP_ACCOUNT_SCOPE, MCP_OFFLINE_SCOPE];
const EXPIRED_TOKEN_MS = 24 * 60 * 60 * 1000;
const ABANDONED_CLIENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Called by MCP clients themselves, from servers and from other web origins.
 * They authenticate with codes and client credentials, never with cookies.
 */
const CLIENT_ENDPOINTS = new Set([
  `${OAUTH_BASE_PATH}/introspect`,
  `${OAUTH_BASE_PATH}/register`,
  `${OAUTH_BASE_PATH}/revoke`,
  `${OAUTH_BASE_PATH}/token`,
]);

const consentResponseSchema = z.object({ url: z.string() });
const authorizeRedirectSchema = consentResponseSchema.extend({
  redirect: z.literal(true),
});

const corsHeaders = {
  "access-control-allow-headers":
    "Authorization, Content-Type, MCP-Protocol-Version",
  "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-max-age": "86400",
};

/** Lets a signed-in person see and end their own connections. */
const connectionsPlugin = {
  endpoints: {
    disconnectMcpClient: createAuthEndpoint(
      "/oauth2/disconnect",
      {
        body: z.object({ clientId: z.string().min(1) }),
        method: "POST",
        use: [sessionMiddleware],
      },
      async (ctx) => {
        await disconnectMcpClient({
          clientId: ctx.body.clientId,
          userId: ctx.context.session.user.id,
        });
        return await ctx.json({ disconnected: true });
      }
    ),
    listMcpConnections: createAuthEndpoint(
      "/oauth2/connections",
      { method: "GET", use: [sessionMiddleware] },
      async (ctx) =>
        await ctx.json(await listMcpConnections(ctx.context.session.user.id))
    ),
  },
  id: "mcp-connections",
} satisfies BetterAuthPlugin;

/**
 * Built per request. The provider reads the database while initializing, and a
 * Worker must not await database work started by another request.
 */
const createMcpAuth = () =>
  betterAuth({
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    baseURL: mcpAuthBaseUrl(),
    database: drizzleAdapter(db, { provider: "pg", schema: tables }),
    plugins: [
      oauthProvider({
        accessTokenExpiresIn: 60 * 60,
        advertisedMetadata: {
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_basic",
            "client_secret_post",
          ],
        },
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // Managing clients and resources over HTTP is not offered to accounts.
        clientPrivileges: () => false,
        clientRegistrationDefaultApplicationType: "infer",
        clientRegistrationDefaultResources: [mcpResourceUrl()],
        consentPage: MCP_CONSENT_PATH,
        disableJwtPlugin: true,
        enforcePerClientResources: true,
        grantTypes: ["authorization_code", "refresh_token"],
        loginPage: MCP_LOGIN_PATH,
        prefix: {
          opaqueAccessToken: MCP_ACCESS_TOKEN_PREFIX,
          refreshToken: "qrt_",
        },
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        // Retried refreshes get the same response instead of losing the grant.
        refreshTokenReuseInterval: 30,
        resourceSeedScope: "process",
        resources: [mcpResourceUrl()],
        scopes: SCOPES,
        storeTokens: { hash: hashMcpToken },
      }),
      connectionsPlugin,
    ],
    // The edge applies shared, database-backed limits to these paths.
    rateLimit: { enabled: false },
    secret: serverEnv.BETTER_AUTH_SECRET,
    trustedOrigins: [mcpAuthBaseUrl()],
  });

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const metadataResponse = (request: Request, body: unknown) =>
  withCors(
    new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "application/json",
      },
    })
  );

/**
 * The provider appends the signed authorization request to its page URLs. One
 * opaque parameter keeps the router from reparsing and reordering it.
 */
const toPageUrl = (location: string) => {
  const url = new URL(location, mcpAuthBaseUrl());
  if (
    url.origin !== mcpAuthBaseUrl() ||
    (url.pathname !== MCP_LOGIN_PATH && url.pathname !== MCP_CONSENT_PATH)
  ) {
    return location;
  }
  return `${url.pathname}?request=${Buffer.from(url.search.slice(1)).toString("base64url")}`;
};

const decodeAuthorizationRequest = (request: string) =>
  Buffer.from(request, "base64url").toString("utf-8");

const handleAuthorize = async (request: Request) => {
  const url = new URL(request.url);
  // Client names are self-asserted, so every grant is confirmed by the person.
  const requiresLogin = url.searchParams
    .get("prompt")
    ?.split(" ")
    .includes("login");
  url.searchParams.set(
    "prompt",
    requiresLogin === true ? "login consent" : "consent"
  );
  if (!url.searchParams.has("resource")) {
    url.searchParams.set("resource", mcpResourceUrl());
  }
  const response = await createMcpAuth().handler(
    new Request(url, { headers: request.headers })
  );
  const location = response.headers.get("location");
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  if (location !== null) {
    headers.set("location", toPageUrl(location));
  } else if (
    response.ok &&
    headers.get("content-type")?.includes("application/json") === true
  ) {
    const redirect = authorizeRedirectSchema.safeParse(
      await response.clone().json()
    );
    if (redirect.success) {
      headers.set("location", toPageUrl(redirect.data.url));
      headers.delete("content-type");
      headers.delete("content-length");
      return new Response(null, { headers, status: 302 });
    }
  }
  return new Response(response.body, { headers, status: response.status });
};

const handleConsent = async (request: Request) => {
  const mcpAuth = createMcpAuth();
  const parsed = z.object({ expectedUserId: z.string() }).safeParse(
    await request
      .clone()
      .json()
      .catch(() => null)
  );
  const session = await mcpAuth.api.getSession({ headers: request.headers });
  if (!parsed.success || session?.user.id !== parsed.data.expectedUserId) {
    return Response.json(
      {
        error: "The signed-in account changed. Reopen the connection request.",
      },
      { status: 409 }
    );
  }
  const response = await mcpAuth.handler(request);
  if (!response.ok) {
    return response;
  }
  const { url } = consentResponseSchema.parse(await response.json());
  return Response.json(
    { url: toPageUrl(url) },
    { headers: { "cache-control": "no-store" } }
  );
};

const removeExpiredTokens = async () => {
  const cutoff = new Date(Date.now() - EXPIRED_TOKEN_MS);
  await db
    .delete(oauthAccessToken)
    .where(
      inArray(
        oauthAccessToken.id,
        db
          .select({ id: oauthAccessToken.id })
          .from(oauthAccessToken)
          .where(lt(oauthAccessToken.expiresAt, cutoff))
          .limit(50)
      )
    );
  await db
    .delete(oauthRefreshToken)
    .where(
      inArray(
        oauthRefreshToken.id,
        db
          .select({ id: oauthRefreshToken.id })
          .from(oauthRefreshToken)
          .where(lt(oauthRefreshToken.expiresAt, cutoff))
          .limit(50)
      )
    );
};

/** Registration is open, so clients nobody ever approved are removed. */
const removeAbandonedClients = async () => {
  const cutoff = new Date(Date.now() - ABANDONED_CLIENT_MS);
  const abandoned = db
    .select({ id: oauthClient.id })
    .from(oauthClient)
    .where(
      and(
        lt(oauthClient.createdAt, cutoff),
        or(isNull(oauthClient.updatedAt), lt(oauthClient.updatedAt, cutoff)),
        notExists(
          db
            .select({ id: oauthConsent.id })
            .from(oauthConsent)
            .where(eq(oauthConsent.clientId, oauthClient.clientId))
        )
      )
    )
    .limit(50);
  await db.delete(oauthClient).where(inArray(oauthClient.id, abandoned));
};

/** Bounded upkeep that never fails the request it runs after. */
const removeUnusedRecords = async (records: "clients" | "tokens") => {
  try {
    await (records === "clients"
      ? removeAbandonedClients()
      : removeExpiredTokens());
  } catch (error) {
    reportError(error, { boundary: "mcp-oauth-upkeep" });
  }
};

const handleClientRequest = async (request: Request) => {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  const response = await createMcpAuth().handler(
    new Request(request, { headers })
  );
  if (url.pathname.endsWith("/register") && response.ok) {
    await removeUnusedRecords("clients");
  } else if (url.pathname.endsWith("/token") && response.ok) {
    await removeUnusedRecords("tokens");
  }
  return withCors(response);
};

/** Serves the OAuth paths, or returns null when the path is not one of them. */
export const handleMcpOAuthRequest = async (
  request: Request
): Promise<Response | null> => {
  const pathname = new URL(request.url).pathname.replace(/\/+$/u, "");
  const isRead = request.method === "GET" || request.method === "HEAD";

  if (
    request.method === "OPTIONS" &&
    (CLIENT_ENDPOINTS.has(pathname) ||
      pathname.startsWith("/.well-known/oauth-"))
  ) {
    return withCors(new Response(null, { status: 204 }));
  }
  if (
    isRead &&
    (pathname === PROTECTED_RESOURCE_METADATA_PATH ||
      pathname ===
        `${PROTECTED_RESOURCE_METADATA_PATH}${new URL(mcpResourceUrl()).pathname}`)
  ) {
    return metadataResponse(request, {
      authorization_servers: [`${mcpAuthBaseUrl()}${AUTH_BASE_PATH}`],
      bearer_methods_supported: ["header"],
      resource: mcpResourceUrl(),
      resource_name: "quieter",
      // Clients that request exactly these scopes also get refresh tokens.
      scopes_supported: SCOPES,
    });
  }
  if (
    isRead &&
    (pathname === AUTHORIZATION_SERVER_METADATA_PATH ||
      pathname === "/.well-known/oauth-authorization-server")
  ) {
    return withCors(
      await createMcpAuth().handler(
        new Request(
          `${mcpAuthBaseUrl()}${AUTHORIZATION_SERVER_METADATA_PATH}`,
          { method: request.method }
        )
      )
    );
  }
  if (request.method === "GET" && pathname === `${OAUTH_BASE_PATH}/authorize`) {
    return await handleAuthorize(request);
  }
  if (request.method === "POST" && pathname === `${OAUTH_BASE_PATH}/consent`) {
    return await handleConsent(request);
  }
  if (
    (request.method === "GET" &&
      pathname === `${OAUTH_BASE_PATH}/connections`) ||
    (request.method === "POST" && pathname === `${OAUTH_BASE_PATH}/disconnect`)
  ) {
    return await createMcpAuth().handler(request);
  }
  if (request.method === "POST" && CLIENT_ENDPOINTS.has(pathname)) {
    return await handleClientRequest(request);
  }
  if (
    pathname.startsWith("/.well-known/") ||
    pathname === OAUTH_BASE_PATH ||
    pathname.startsWith(`${OAUTH_BASE_PATH}/`)
  ) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
};

/**
 * Resumes an authorization request after sign-in. Returns null when the person
 * still has to sign in, including when the client asked for a fresh sign-in.
 */
export const resumeMcpAuthorization = (
  request: string,
  session: { createdAt: Date } | null
) => {
  const params = new URLSearchParams(decodeAuthorizationRequest(request));
  const issuedAt = Number(params.get("ba_iat"));
  const isFresh =
    session !== null && new Date(session.createdAt).getTime() >= issuedAt;
  const prompts = params.get("prompt")?.split(" ") ?? [];
  const requiresFreshSession =
    prompts.includes("login") || params.has("max_age");
  if (session === null || (requiresFreshSession && !isFresh)) {
    return null;
  }
  const resumed = new URLSearchParams(
    [...params].filter(
      ([name]) =>
        !["exp", "max_age", "prompt", "sig"].includes(name) &&
        !name.startsWith("ba_")
    )
  );
  return `${OAUTH_BASE_PATH}/authorize?${resumed}`;
};

/** Describes a signed authorization request for the consent page. */
export const getMcpConsentRequest = async (request: string) => {
  const query = decodeAuthorizationRequest(request);
  if (
    serverEnv.BETTER_AUTH_SECRET === undefined ||
    !(await verifyOAuthQueryParams(query, serverEnv.BETTER_AUTH_SECRET))
  ) {
    return null;
  }
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const scopes = params.get("scope")?.split(" ") ?? [];
  if (
    clientId === null ||
    redirectUri === null ||
    !scopes.includes(MCP_ACCOUNT_SCOPE)
  ) {
    return null;
  }
  const [client] = await db
    .select({ name: oauthClient.name })
    .from(oauthClient)
    .where(
      and(
        eq(oauthClient.clientId, clientId),
        or(isNull(oauthClient.disabled), eq(oauthClient.disabled, false))
      )
    )
    .limit(1);
  if (client === undefined) {
    return null;
  }
  const redirect = new URL(redirectUri);
  return {
    clientName: client.name?.trim().slice(0, 80) || "An app",
    destination:
      redirect.protocol === "https:" ? redirect.host : "an app on this device",
    query,
    staysConnected: scopes.includes(MCP_OFFLINE_SCOPE),
  };
};
