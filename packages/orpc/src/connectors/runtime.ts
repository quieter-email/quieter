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
import { hasText } from "../text";

export const GOOGLE_CALENDAR_CONNECTOR_PROVIDER = "google_calendar" as const;
export const LINEAR_CONNECTOR_PROVIDER = "linear" as const;
const CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
export const LINEAR_AUTHORIZATION_URL = "https://linear.app/oauth/authorize";
export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
const LINEAR_MCP_PROTOCOL_VERSION = "2025-06-18";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const permanentGoogleTokenErrors = new Set(["invalid_grant", "invalid_token"]);
const permanentLinearTokenErrors = new Set(["invalid_grant", "invalid_token"]);

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

export type LinearMcpToolDescriptor = {
  description?: string;
  inputSchema?: unknown;
  name: string;
};
export type LinearMcpToolCallInput = {
  arguments?: Record<string, unknown>;
  toolName: string;
};
export type LinearMcpToolCallResult = {
  arguments?: Record<string, unknown>;
  durationMs: number;
  error?: string;
  output?: unknown;
  status: "error" | "success";
  toolName: string;
};

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.events",
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

const mcpToolSchema = z.object({
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
  name: z.string().min(1),
});

const mcpToolsListResultSchema = z.object({
  tools: z.array(mcpToolSchema),
});

const mcpResponseSchema = z.object({
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
    })
    .optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  jsonrpc: z.string().optional(),
  result: z.unknown().optional(),
});

const getGoogleCalendarOAuthClient = () => ({
  clientId: requireServerEnv("GOOGLE_CALENDAR_CLIENT_ID"),
  clientSecret: requireServerEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
});

const getLinearOAuthClient = () => ({
  clientId: requireServerEnv("LINEAR_CLIENT_ID"),
  clientSecret: requireServerEnv("LINEAR_CLIENT_SECRET"),
});

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

const runAuthorizedConnector = async <TValue>(
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

const getAuthorizedConnectorCredentialAccessToken = async (input: {
  credentialId: string;
  provider: ConnectorProvider;
  userId?: string;
}) => {
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
    .where(
      input.userId === undefined
        ? and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider)
          )
        : and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
            eq(connectorCredential.userId, input.userId)
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
  const [record] = await db
    .select({
      encryptedRefreshToken: connectorCredential.encryptedRefreshToken,
      id: connectorCredential.id,
      provider: connectorCredential.provider,
    })
    .from(connectorCredential)
    .where(
      input.userId === undefined
        ? and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider)
          )
        : and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
            eq(connectorCredential.userId, input.userId)
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

const runAuthorizedConnectorCredential = async <TValue>(
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
  signal?: AbortSignal;
}) => {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API_URL}/calendars/primary/events`,
    {
      body: JSON.stringify(input.event),
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: input.signal,
    }
  );

  if (!response.ok) {
    throw await createGoogleApiError(response);
  }

  return googleCalendarEventResponseSchema.parse(await response.json());
};

type GoogleCalendarEventDraft = {
  description?: string;
  end:
    | { date: string; dateTime?: never; timeZone?: never }
    | { date?: never; dateTime: string; timeZone?: string };
  location?: string;
  start:
    | { date: string; dateTime?: never; timeZone?: never }
    | { date?: never; dateTime: string; timeZone?: string };
  summary: string;
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

export const getLinearMcpEndpoint = () => LINEAR_MCP_URL;

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
/** The one Linear read that is not a tool call: naming the connection being made. */
const LINEAR_IDENTITY_QUERY = `query ConnectorIdentity {
  viewer { displayName email id name }
  organization { id name }
}`;

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
  if (hasText(viewer.displayName)) {
    return viewer.displayName;
  }
  if (hasText(viewer.name)) {
    return viewer.name;
  }
  return viewer.email;
};

export const getLinearIdentityFromAccessToken = async (accessToken: string) => {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    body: JSON.stringify({ query: LINEAR_IDENTITY_QUERY }),
    headers: {
      Authorization: accessToken,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new ConnectorHttpError(
      "Linear rejected the connection.",
      response.status
    );
  }

  const { data } = linearIdentitySchema.parse(await response.json());
  return {
    accountEmail: data.viewer.email,
    displayName: resolveLinearDisplayName(data.viewer),
    providerAccountId: data.viewer.id,
    providerWorkspaceId: data.organization.id,
    providerWorkspaceName: data.organization.name,
  };
};

const normalizeLinearMcpToolName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^linear[-_:]/u, "")
    .replace(/^linear_/u, "");

const LINEAR_MCP_READ_PREFIXES = ["get_", "list_", "search_"];

/**
 * Linear names its tools by verb, so the prefix is what separates a lookup from a
 * change. Anything that is not plainly a read is treated as mutating, which routes it
 * through the write path and its approval instead of running unattended.
 */
export const isMutatingLinearMcpTool = (tool: LinearMcpToolDescriptor) => {
  const name = normalizeLinearMcpToolName(tool.name);
  return !LINEAR_MCP_READ_PREFIXES.some((prefix) => name.startsWith(prefix));
};

const createConnectorHttpError = (message: string, status: number) =>
  new ConnectorHttpError(message, status);

const truncateJsonValue = (value: unknown, maxLength: number) => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length <= maxLength) {
    return value;
  }

  return {
    truncated: true,
    value: serialized.slice(0, maxLength),
  };
};

type McpResponse = z.infer<typeof mcpResponseSchema>;

const parseMcpResponseText = (input: {
  contentType: string;
  requestId: number;
  text: string;
}): McpResponse | undefined => {
  if (!hasText(input.text.trim())) {
    return undefined;
  }

  if (!input.contentType.includes("text/event-stream")) {
    return mcpResponseSchema.parse(JSON.parse(input.text));
  }

  const messages = input.text
    .split(/\r?\n\r?\n/u)
    .map((block) =>
      block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n")
    )
    .filter((data) => hasText(data) && data !== "[DONE]")
    .map((data) => mcpResponseSchema.parse(JSON.parse(data)));

  return (
    messages.find((message) => message.id === input.requestId) ??
    messages.find((message) => "result" in message || "error" in message)
  );
};

const postLinearMcpMessage = async (input: {
  accessToken: string;
  body: unknown;
  requestId?: number;
  sessionId?: string;
  signal?: AbortSignal;
}) => {
  const response = await fetch(LINEAR_MCP_URL, {
    body: JSON.stringify(input.body),
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      "mcp-protocol-version": LINEAR_MCP_PROTOCOL_VERSION,
      ...(hasText(input.sessionId)
        ? { "mcp-session-id": input.sessionId }
        : {}),
    },
    method: "POST",
    signal: input.signal,
  });
  const sessionId = response.headers.get("mcp-session-id") ?? input.sessionId;

  if (response.status === 202) {
    return { result: undefined, sessionId };
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw createConnectorHttpError(
      hasText(text)
        ? text
        : `Linear MCP request failed with status ${response.status}.`,
      response.status
    );
  }

  const parsed = parseMcpResponseText({
    contentType: response.headers.get("content-type") ?? "",
    requestId: input.requestId ?? 0,
    text,
  });
  if (parsed?.error) {
    throw new Error(parsed.error.message ?? "Linear MCP returned an error.");
  }

  return { result: parsed?.result, sessionId };
};

const createLinearMcpSession = async (input: {
  accessToken: string;
  signal?: AbortSignal;
}) => {
  const initialized = await postLinearMcpMessage({
    accessToken: input.accessToken,
    body: {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: {
          name: "quieter-mailbox-actions",
          version: "0.1.0",
        },
        protocolVersion: LINEAR_MCP_PROTOCOL_VERSION,
      },
    },
    requestId: 1,
    signal: input.signal,
  });
  if (!hasText(initialized.sessionId)) {
    throw new Error("Linear MCP did not return a session id.");
  }

  await postLinearMcpMessage({
    accessToken: input.accessToken,
    body: {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    sessionId: initialized.sessionId,
    signal: input.signal,
  });

  return { sessionId: initialized.sessionId };
};

const listLinearMcpTools = async (
  accessToken: string,
  signal?: AbortSignal
): Promise<LinearMcpToolDescriptor[]> => {
  const session = await createLinearMcpSession({ accessToken, signal });
  const listed = await postLinearMcpMessage({
    accessToken,
    body: {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
    },
    requestId: 2,
    sessionId: session.sessionId,
    signal,
  });
  const result = mcpToolsListResultSchema.parse(listed.result);

  // Every tool the workspace exposes is offered. The connection is the user's own
  // per-user OAuth grant, so Linear has already scoped what this token may do.
  return result.tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
  }));
};

const callSingleLinearMcpTool = async (input: {
  accessToken: string;
  allowedTools: Map<string, LinearMcpToolDescriptor>;
  call: LinearMcpToolCallInput;
  index: number;
  maxOutputBytes: number;
  sessionId: string;
  signal?: AbortSignal;
}): Promise<LinearMcpToolCallResult> => {
  const startedAt = Date.now();
  if (!input.allowedTools.has(input.call.toolName)) {
    return {
      arguments: input.call.arguments,
      durationMs: Date.now() - startedAt,
      error: "Tool is not in the Linear MCP read allowlist.",
      status: "error",
      toolName: input.call.toolName,
    };
  }

  try {
    const response = await postLinearMcpMessage({
      accessToken: input.accessToken,
      body: {
        id: 10 + input.index,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: input.call.arguments ?? {},
          name: input.call.toolName,
        },
      },
      requestId: 10 + input.index,
      sessionId: input.sessionId,
      signal: input.signal,
    });
    return {
      arguments: input.call.arguments,
      durationMs: Date.now() - startedAt,
      output: truncateJsonValue(response.result, input.maxOutputBytes),
      status: "success",
      toolName: input.call.toolName,
    };
  } catch (error) {
    return {
      arguments: input.call.arguments,
      durationMs: Date.now() - startedAt,
      error:
        error instanceof Error ? error.message : "Linear MCP tool call failed.",
      status: "error",
      toolName: input.call.toolName,
    };
  }
};

const callLinearMcpToolsSequentially = async (input: {
  accessToken: string;
  allowedTools: Map<string, LinearMcpToolDescriptor>;
  calls: LinearMcpToolCallInput[];
  maxOutputBytes: number;
  sessionId: string;
  signal?: AbortSignal;
  startIndex?: number;
}): Promise<LinearMcpToolCallResult[]> => {
  if (input.calls.length === 0) {
    return [];
  }

  const [call, ...remainingCalls] = input.calls;
  const startIndex = input.startIndex ?? 0;
  const result = await callSingleLinearMcpTool({
    accessToken: input.accessToken,
    allowedTools: input.allowedTools,
    call,
    index: startIndex,
    maxOutputBytes: input.maxOutputBytes,
    sessionId: input.sessionId,
    signal: input.signal,
  });

  return [
    result,
    ...(await callLinearMcpToolsSequentially({
      ...input,
      calls: remainingCalls,
      startIndex: startIndex + 1,
    })),
  ];
};

const callLinearMcpTools = async (input: {
  accessToken: string;
  calls: LinearMcpToolCallInput[];
  maxCalls?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}): Promise<LinearMcpToolCallResult[]> => {
  const tools = await listLinearMcpTools(input.accessToken, input.signal);
  const allowedTools = new Map(tools.map((tool) => [tool.name, tool]));
  const session = await createLinearMcpSession({
    accessToken: input.accessToken,
    signal: input.signal,
  });
  const maxCalls = input.maxCalls ?? 4;
  const maxOutputBytes = input.maxOutputBytes ?? 8000;

  return await callLinearMcpToolsSequentially({
    accessToken: input.accessToken,
    allowedTools,
    calls: input.calls.slice(0, maxCalls),
    maxOutputBytes,
    sessionId: session.sessionId,
    signal: input.signal,
  });
};

/** A refreshed token for the caller's own Linear connection, for the MCP client. */
export const getLinearAccessTokenForUser = async (input: { userId: string }) =>
  await getAuthorizedConnectorAccessToken({
    provider: LINEAR_CONNECTOR_PROVIDER,
    userId: input.userId,
  });

export const listLinearMcpToolsForUser = async (input: {
  signal?: AbortSignal;
  userId: string;
}): Promise<LinearMcpToolDescriptor[]> =>
  await runAuthorizedConnector(
    {
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, signal) => await listLinearMcpTools(accessToken, signal)
  );

export const runLinearMcpToolCallsForUser = async (input: {
  calls: LinearMcpToolCallInput[];
  maxCalls?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  userId: string;
}): Promise<LinearMcpToolCallResult[]> =>
  await runAuthorizedConnector(
    {
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, signal) =>
      await callLinearMcpTools({
        accessToken,
        calls: input.calls,
        maxCalls: input.maxCalls,
        maxOutputBytes: input.maxOutputBytes,
        signal,
      })
  );

export const listLinearMcpToolsForCredential = async (input: {
  credentialId: string;
  signal?: AbortSignal;
  userId?: string;
}): Promise<LinearMcpToolDescriptor[]> =>
  await runAuthorizedConnectorCredential(
    {
      credentialId: input.credentialId,
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, _credential, signal) =>
      await listLinearMcpTools(accessToken, signal)
  );

export const runLinearMcpToolCallsForCredential = async (input: {
  calls: LinearMcpToolCallInput[];
  credentialId: string;
  maxCalls?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  userId?: string;
}): Promise<LinearMcpToolCallResult[]> =>
  await runAuthorizedConnectorCredential(
    {
      credentialId: input.credentialId,
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, _credential, signal) =>
      await callLinearMcpTools({
        accessToken,
        calls: input.calls,
        maxCalls: input.maxCalls,
        maxOutputBytes: input.maxOutputBytes,
        signal,
      })
  );

const createGoogleCalendarEvent = async (input: {
  accessToken: string;
  event: GoogleCalendarEventInput;
  signal?: AbortSignal;
}) => {
  const eventDraft = normalizeGoogleCalendarEvent(input.event);
  const event = await postGoogleCalendarEvent({
    accessToken: input.accessToken,
    event: eventDraft,
    signal: input.signal,
  });

  return {
    htmlLink: event.htmlLink,
    id: event.id,
    status: "success" as const,
    summary: event.summary ?? eventDraft.summary,
  };
};

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
    async (accessToken, signal) =>
      await createGoogleCalendarEvent({
        accessToken,
        event: input.event,
        signal,
      })
  );

export const createGoogleCalendarEventForCredential = async (input: {
  credentialId: string;
  event: GoogleCalendarEventInput;
  signal?: AbortSignal;
  userId?: string;
}) =>
  await runAuthorizedConnectorCredential(
    {
      credentialId: input.credentialId,
      provider: GOOGLE_CALENDAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken, _credential, signal) =>
      await createGoogleCalendarEvent({
        accessToken,
        event: input.event,
        signal,
      })
  );
