import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { z } from "zod";

import type { ConnectorProvider } from "./contracts";

export const LINEAR_SCOPES = ["read", "write"] as const;

type OAuthProvider = {
  authorizationUrl: string;
  tokenUrl: string;
  clientId:
    | "LINEAR_CLIENT_ID"
    | "NOTION_CLIENT_ID"
    | "TODOIST_CLIENT_ID"
    | "CLICKUP_CLIENT_ID"
    | "MICROSOFT_CLIENT_ID";
  clientSecret:
    | "LINEAR_CLIENT_SECRET"
    | "NOTION_CLIENT_SECRET"
    | "TODOIST_CLIENT_SECRET"
    | "CLICKUP_CLIENT_SECRET"
    | "MICROSOFT_CLIENT_SECRET";
  description: string;
  scopes: readonly string[];
  pkce: boolean;
};

const microsoftOAuth = {
  authorizationUrl:
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  clientId: "MICROSOFT_CLIENT_ID",
  clientSecret: "MICROSOFT_CLIENT_SECRET",
  pkce: true,
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
} as const;

export const oauthProviders = {
  clickup: {
    authorizationUrl: "https://app.clickup.com/api",
    clientId: "CLICKUP_CLIENT_ID",
    clientSecret: "CLICKUP_CLIENT_SECRET",
    description: "Find and update tasks in your selected workspaces.",
    pkce: false,
    scopes: [],
    tokenUrl: "https://api.clickup.com/api/v2/oauth/token",
  },
  linear: {
    authorizationUrl: "https://linear.app/oauth/authorize",
    clientId: "LINEAR_CLIENT_ID",
    clientSecret: "LINEAR_CLIENT_SECRET",
    description: "Find and update issues in your workspaces.",
    pkce: true,
    scopes: LINEAR_SCOPES,
    tokenUrl: "https://api.linear.app/oauth/token",
  },
  microsoft_calendar: {
    ...microsoftOAuth,
    description: "Find availability and manage your calendar events.",
    scopes: ["User.Read", "Calendars.ReadWrite"],
  },
  microsoft_onedrive: {
    ...microsoftOAuth,
    description: "Find and read files in your drive.",
    scopes: ["User.Read", "Files.Read"],
  },
  notion: {
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    clientId: "NOTION_CLIENT_ID",
    clientSecret: "NOTION_CLIENT_SECRET",
    description: "Find and update the pages you choose to share.",
    pkce: false,
    scopes: [],
    tokenUrl: "https://api.notion.com/v1/oauth/token",
  },
  todoist: {
    authorizationUrl: "https://app.todoist.com/oauth/authorize",
    clientId: "TODOIST_CLIENT_ID",
    clientSecret: "TODOIST_CLIENT_SECRET",
    description: "Find, create, and complete your tasks.",
    pkce: false,
    scopes: ["data:read_write"],
    tokenUrl: "https://api.todoist.com/oauth/access_token",
  },
} as const satisfies Record<ConnectorProvider, OAuthProvider>;

export const isConnectorOAuthConfigured = (provider: ConnectorProvider) => {
  const definition = oauthProviders[provider];
  return Boolean(
    serverEnv.BETTER_AUTH_URL &&
    serverEnv[definition.clientId] &&
    serverEnv[definition.clientSecret] &&
    serverEnv.CONNECTOR_TOKEN_ENCRYPTION_KEY
  );
};

export const getConnectorOAuthClient = (provider: ConnectorProvider) => {
  const definition = oauthProviders[provider];
  return {
    clientId: requireServerEnv(definition.clientId),
    clientSecret: requireServerEnv(definition.clientSecret),
  };
};

const connectorTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
});

export class ConnectorTokenError extends Error {
  readonly permanent: boolean;
  constructor(permanent: boolean) {
    super("The connection could not renew its access.");
    this.name = "ConnectorTokenError";
    this.permanent = permanent;
  }
}

export const requestConnectorToken = async (
  provider: ConnectorProvider,
  grant: { code: string; codeVerifier: string } | { refreshToken: string },
  signal?: AbortSignal
) => {
  const definition = oauthProviders[provider];
  const config = getConnectorOAuthClient(provider);
  const parameters: Record<string, string> =
    "code" in grant
      ? {
          code: grant.code,
          grant_type: "authorization_code",
          redirect_uri: `${requireServerEnv("BETTER_AUTH_URL").replace(/\/+$/u, "")}/api/connectors/callback`,
        }
      : { grant_type: "refresh_token", refresh_token: grant.refreshToken };
  if ("code" in grant && definition.pkce) {
    parameters.code_verifier = grant.codeVerifier;
  }
  if (provider.startsWith("microsoft_")) {
    parameters.scope = [...definition.scopes, "offline_access"].join(" ");
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (provider === "notion") {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    parameters.client_id = config.clientId;
    parameters.client_secret = config.clientSecret;
  }
  const json = provider === "notion" || provider === "clickup";
  headers["Content-Type"] = json
    ? "application/json"
    : "application/x-www-form-urlencoded";
  const response = await fetch(definition.tokenUrl, {
    body: json ? JSON.stringify(parameters) : new URLSearchParams(parameters),
    headers,
    method: "POST",
    signal:
      signal === undefined
        ? AbortSignal.timeout(15_000)
        : AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) {
    const error = z
      .object({ error: z.string().optional() })
      .safeParse(await response.json().catch(() => null));
    throw new ConnectorTokenError(
      response.status === 401 ||
        (error.success &&
          ["invalid_grant", "invalid_token"].includes(error.data.error ?? ""))
    );
  }
  const body: unknown = await response.json();
  const parsed = connectorTokenSchema.safeParse(body);
  if (
    !parsed.success ||
    ((provider === "linear" || provider.startsWith("microsoft_")) &&
      parsed.data.expires_in === undefined)
  ) {
    throw new Error(
      "The connection returned an invalid authorization response."
    );
  }
  return { body, token: parsed.data };
};

export const getOAuthConnectorIdentity = async (
  provider: Exclude<ConnectorProvider, "linear">,
  accessToken: string,
  tokenBody: unknown
) => {
  if (provider === "notion") {
    const token = z
      .object({
        bot_id: z.string(),
        owner: z
          .object({
            user: z
              .object({
                id: z.string(),
                name: z.string().nullish(),
                person: z.object({ email: z.string().nullish() }).nullish(),
              })
              .optional(),
          })
          .optional(),
        workspace_id: z.string(),
        workspace_name: z.string().nullish(),
      })
      .parse(tokenBody);
    return {
      accountEmail: token.owner?.user?.person?.email ?? null,
      displayName: token.owner?.user?.name ?? token.workspace_name ?? "Notion",
      providerAccountId: `${token.workspace_id}:${token.owner?.user?.id ?? token.bot_id}`,
      providerWorkspaceId: token.workspace_id,
      providerWorkspaceName: token.workspace_name ?? null,
    };
  }
  const identityUrls = {
    clickup: "https://api.clickup.com/api/v2/user",
    microsoft_calendar:
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    microsoft_onedrive:
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    todoist: "https://api.todoist.com/api/v1/user",
  };
  const url = identityUrls[provider];
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error("The connection could not identify your account.");
  }
  const body: unknown = await response.json();
  if (provider === "todoist") {
    const user = z
      .object({
        email: z.string(),
        full_name: z.string(),
        id: z.union([z.string(), z.number()]),
      })
      .parse(body);
    return {
      accountEmail: user.email,
      displayName: user.full_name,
      providerAccountId: String(user.id),
      providerWorkspaceId: null,
      providerWorkspaceName: null,
    };
  }
  if (provider === "clickup") {
    const { user } = z
      .object({
        user: z.object({
          email: z.string(),
          id: z.number(),
          username: z.string().nullish(),
        }),
      })
      .parse(body);
    return {
      accountEmail: user.email,
      displayName: user.username ?? user.email,
      providerAccountId: String(user.id),
      providerWorkspaceId: null,
      providerWorkspaceName: null,
    };
  }
  const user = z
    .object({
      displayName: z.string().nullish(),
      id: z.string(),
      mail: z.string().nullish(),
      userPrincipalName: z.string().nullish(),
    })
    .parse(body);
  return {
    accountEmail: user.mail ?? user.userPrincipalName ?? null,
    displayName: user.displayName ?? null,
    providerAccountId: user.id,
    providerWorkspaceId: null,
    providerWorkspaceName: null,
  };
};
