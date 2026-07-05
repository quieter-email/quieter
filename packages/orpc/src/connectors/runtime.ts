import type {
  LinearIssueCreateInput,
  LinearIssueCreateResult,
  LinearIssueMetadataResult,
} from "@quieter/ai/chat-agent";
import { LinearClient } from "@linear/sdk";
import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { connectorCredential, type ConnectorProvider } from "@quieter/database/schema";
import { requireServerEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  decryptGmailCredentialSecret,
  encryptGmailCredentialSecret,
} from "../gmail-credential-crypto";

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

type LinearIssueMetadataSuccess = Extract<LinearIssueMetadataResult, { status: "success" }>;
type LinearIssueCreateSuccess = Extract<LinearIssueCreateResult, { status: "success" }>;
export type LinearIssueCreateDraft = LinearIssueCreateInput;
export type LinearIssueMetadata = Omit<LinearIssueMetadataSuccess, "status">;
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
export const LINEAR_SCOPES = ["read", "issues:create"] as const;

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
  htmlLink: z.string().url().optional(),
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

  throw new ORPCError("BAD_REQUEST", { message: "Connector is not supported." });
};

const getConnectorCredentialEncryptionKey = () =>
  requireServerEnv("CONNECTOR_TOKEN_ENCRYPTION_KEY");

const encryptConnectorSecret = (value: string) =>
  encryptGmailCredentialSecret(value, { legacyKey: getConnectorCredentialEncryptionKey() });

const decryptConnectorSecret = (value: string) =>
  decryptGmailCredentialSecret(value, { legacyKey: getConnectorCredentialEncryptionKey() });

const normalizeOAuthScope = (scope: string | string[]) =>
  Array.isArray(scope) ? scope.join(" ") : scope;

const createGoogleApiError = async (response: Response) => {
  const body = await response.text().catch(() => "");
  const parsedBody = (() => {
    if (!body.trim()) {
      return null;
    }

    try {
      return googleApiErrorSchema.parse(JSON.parse(body));
    } catch {
      return null;
    }
  })();
  const message =
    parsedBody?.error.message ||
    body ||
    `Google Calendar request failed with status ${response.status}.`;
  const error = new Error(message) as Error & { status: number };
  error.status = response.status;
  return error;
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
        eq(connectorCredential.status, "connected"),
      ),
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
  if (!record.encryptedRefreshToken) {
    await db
      .update(connectorCredential)
      .set({ status: "needs_reconnect", updatedAt: new Date() })
      .where(eq(connectorCredential.id, record.id));
    throw getConnectorRepairRequiredError(record.provider);
  }

  const config = getConnectorOAuthClient(record.provider);
  const response = await fetch(
    record.provider === LINEAR_CONNECTOR_PROVIDER ? LINEAR_TOKEN_URL : GOOGLE_TOKEN_URL,
    {
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: decryptConnectorSecret(record.encryptedRefreshToken),
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  );

  if (!response.ok) {
    const body = await response
      .json()
      .then((value: unknown) => z.object({ error: z.string().optional() }).safeParse(value))
      .catch(() => null);
    const errorCode = body?.success ? body.data.error : undefined;
    const permanentErrors =
      record.provider === LINEAR_CONNECTOR_PROVIDER
        ? permanentLinearTokenErrors
        : permanentGoogleTokenErrors;
    if (
      response.status === 400 ||
      response.status === 401 ||
      (errorCode && permanentErrors.has(errorCode))
    ) {
      await db
        .update(connectorCredential)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(connectorCredential.id, record.id));
      throw getConnectorRepairRequiredError(record.provider);
    }

    throw new Error(
      `${connectorDefinitions[record.provider].displayName} token refresh failed with status ${response.status}.`,
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
      accessTokenExpiresAt: new Date(now.getTime() + refreshed.expires_in * 1000),
      encryptedAccessToken: encryptConnectorSecret(refreshed.access_token),
      encryptedRefreshToken:
        "refresh_token" in refreshed && refreshed.refresh_token
          ? encryptConnectorSecret(refreshed.refresh_token)
          : record.encryptedRefreshToken,
      scopes: refreshed.scope
        ? normalizeOAuthScope(refreshed.scope)
        : connectorDefinitions[record.provider].scopes.join(" "),
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
        eq(connectorCredential.provider, input.provider),
      ),
    )
    .limit(1);

  if (!record) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  if (record.status === "needs_reconnect") {
    throw getConnectorRepairRequiredError(record.provider);
  }

  if (
    record.encryptedAccessToken &&
    record.accessTokenExpiresAt &&
    record.accessTokenExpiresAt.getTime() > Date.now() + CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS
  ) {
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
        eq(connectorCredential.provider, input.provider),
      ),
    )
    .limit(1);

  if (!record) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  return await refreshConnectorAccessToken(record);
};

const runAuthorizedConnector = async <TValue>(
  input: { provider: ConnectorProvider; signal?: AbortSignal; userId: string },
  runner: (accessToken: string, signal?: AbortSignal) => Promise<TValue>,
) => {
  const accessToken = await getAuthorizedConnectorAccessToken(input);

  try {
    return await runner(accessToken, input.signal);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("status" in error) ||
      (error as { status?: unknown }).status !== 401
    ) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshAuthorizedConnectorAccessToken(input);
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
      input.userId
        ? and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
            eq(connectorCredential.userId, input.userId),
          )
        : and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
          ),
    )
    .limit(1);

  if (!record) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Connect ${connectorDefinitions[input.provider].displayName} before using this action.`,
    });
  }

  if (record.status === "needs_reconnect") {
    throw getConnectorRepairRequiredError(record.provider);
  }

  const accessToken =
    record.encryptedAccessToken &&
    record.accessTokenExpiresAt &&
    record.accessTokenExpiresAt.getTime() > Date.now() + CONNECTOR_ACCESS_TOKEN_EXPIRY_BUFFER_MS
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
      input.userId
        ? and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
            eq(connectorCredential.userId, input.userId),
          )
        : and(
            eq(connectorCredential.id, input.credentialId),
            eq(connectorCredential.provider, input.provider),
          ),
    )
    .limit(1);

  if (!record) {
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
    signal?: AbortSignal,
  ) => Promise<TValue>,
) => {
  const credential = await getAuthorizedConnectorCredentialAccessToken(input);

  try {
    return await runner(credential.accessToken, { userId: credential.userId }, input.signal);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("status" in error) ||
      (error as { status?: unknown }).status !== 401
    ) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshAuthorizedConnectorCredentialAccessToken(input);
  return await runner(refreshedAccessToken, { userId: credential.userId }, input.signal);
};

const postGoogleCalendarEvent = async (input: {
  accessToken: string;
  event: GoogleCalendarEventDraft;
  signal?: AbortSignal;
}) => {
  const response = await fetch(`${GOOGLE_CALENDAR_API_URL}/calendars/primary/events`, {
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
  value: GoogleCalendarEventInput["start"],
): GoogleCalendarEventDraft["start"] => {
  if (value.date && !value.dateTime) {
    return { date: value.date };
  }

  if (value.dateTime && !value.date) {
    return value.timeZone
      ? { dateTime: value.dateTime, timeZone: value.timeZone }
      : { dateTime: value.dateTime };
  }

  throw new ORPCError("BAD_REQUEST", {
    message: "Calendar events require exactly one date or date-time for both start and end.",
  });
};

const normalizeGoogleCalendarEvent = (
  event: GoogleCalendarEventInput,
): GoogleCalendarEventDraft => ({
  ...(event.description ? { description: event.description } : {}),
  end: normalizeGoogleCalendarEventDate(event.end),
  ...(event.location ? { location: event.location } : {}),
  start: normalizeGoogleCalendarEventDate(event.start),
  summary: event.summary,
});

const createLinearClient = (accessToken: string) => new LinearClient({ accessToken });

export const getLinearMcpEndpoint = () => LINEAR_MCP_URL;

export const getLinearIdentityFromAccessToken = async (accessToken: string) => {
  const client = createLinearClient(accessToken);
  const [viewer, organization] = await Promise.all([client.viewer, client.organization]);
  return {
    accountEmail: viewer.email,
    displayName: viewer.displayName ?? viewer.name ?? viewer.email,
    providerAccountId: viewer.id,
    providerWorkspaceId: organization.id,
    providerWorkspaceName: organization.name,
  };
};

const allowedLinearMcpReadTools = new Set([
  "get_cycle",
  "get_document",
  "get_issue",
  "get_issue_status",
  "get_project",
  "get_team",
  "get_user",
  "list_comments",
  "list_cycles",
  "list_documents",
  "list_issue_labels",
  "list_issue_statuses",
  "list_issues",
  "list_projects",
  "list_teams",
  "list_users",
  "search_issues",
]);

const normalizeLinearMcpToolName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^linear[-_:]/, "")
    .replace(/^linear_/, "");

const isAllowedLinearMcpReadTool = (tool: LinearMcpToolDescriptor) =>
  allowedLinearMcpReadTools.has(normalizeLinearMcpToolName(tool.name));

const createConnectorHttpError = (message: string, status: number) => {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
};

const truncateJsonValue = (value: unknown, maxLength: number) => {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length <= maxLength) return value;

  return {
    truncated: true,
    value: serialized.slice(0, maxLength),
  };
};

const parseMcpResponseText = (input: { contentType: string; requestId: number; text: string }) => {
  if (!input.text.trim()) return undefined;

  if (!input.contentType.includes("text/event-stream")) {
    return mcpResponseSchema.parse(JSON.parse(input.text));
  }

  const messages = input.text
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n"),
    )
    .filter((data) => data && data !== "[DONE]")
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
      ...(input.sessionId ? { "mcp-session-id": input.sessionId } : {}),
    },
    method: "POST",
    signal: input.signal,
  });
  const sessionId = response.headers.get("mcp-session-id") ?? input.sessionId;

  if (response.status === 202) return { result: undefined, sessionId };

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw createConnectorHttpError(
      text || `Linear MCP request failed with status ${response.status}.`,
      response.status,
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

const createLinearMcpSession = async (input: { accessToken: string; signal?: AbortSignal }) => {
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
  if (!initialized.sessionId) {
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
  signal?: AbortSignal,
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

  return result.tools
    .map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name,
    }))
    .filter(isAllowedLinearMcpReadTool);
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
  const maxOutputBytes = input.maxOutputBytes ?? 8_000;
  const results: LinearMcpToolCallResult[] = [];

  for (const [index, call] of input.calls.slice(0, maxCalls).entries()) {
    const startedAt = Date.now();
    if (!allowedTools.has(call.toolName)) {
      results.push({
        arguments: call.arguments,
        durationMs: Date.now() - startedAt,
        error: "Tool is not in the Linear MCP read allowlist.",
        status: "error",
        toolName: call.toolName,
      });
      continue;
    }

    try {
      const response = await postLinearMcpMessage({
        accessToken: input.accessToken,
        body: {
          id: 10 + index,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: call.arguments ?? {},
            name: call.toolName,
          },
        },
        requestId: 10 + index,
        sessionId: session.sessionId,
        signal: input.signal,
      });
      results.push({
        arguments: call.arguments,
        durationMs: Date.now() - startedAt,
        output: truncateJsonValue(response.result, maxOutputBytes),
        status: "success",
        toolName: call.toolName,
      });
    } catch (error) {
      results.push({
        arguments: call.arguments,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Linear MCP tool call failed.",
        status: "error",
        toolName: call.toolName,
      });
    }
  }

  return results;
};

const readLinearIssueMetadata = async (
  accessToken: string,
): Promise<LinearIssueMetadataSuccess> => {
  const client = createLinearClient(accessToken);
  const [teams, labels, states, projects, users] = await Promise.all([
    client.teams({ first: 100 }),
    client.issueLabels({ first: 200 }),
    client.workflowStates({ first: 200 }),
    client.projects({ first: 100 }),
    client.users({ first: 100 }),
  ]);

  return {
    labels: labels.nodes.map((label) => ({
      color: label.color,
      description: label.description,
      id: label.id,
      isGroup: label.isGroup,
      name: label.name,
      parentId: label.parentId,
      teamId: label.teamId,
    })),
    projects: projects.nodes.map((project) => ({
      description: project.description,
      id: project.id,
      name: project.name,
    })),
    states: states.nodes.map((state) => ({
      color: state.color,
      id: state.id,
      name: state.name,
      teamId: state.teamId,
      type: state.type,
    })),
    status: "success",
    teams: teams.nodes.map((team) => ({
      description: team.description,
      displayName: team.displayName,
      id: team.id,
      key: team.key,
      name: team.name,
    })),
    users: users.nodes.map((user) => ({
      active: user.active,
      displayName: user.displayName,
      email: user.email,
      id: user.id,
      isAssignable: user.isAssignable,
      name: user.name,
    })),
  };
};

const createLinearIssue = async (
  accessToken: string,
  issue: LinearIssueCreateInput,
): Promise<LinearIssueCreateSuccess> => {
  const client = createLinearClient(accessToken);
  const issueInput: Parameters<LinearClient["createIssue"]>[0] = {
    ...(issue.assigneeId ? { assigneeId: issue.assigneeId } : {}),
    ...(issue.description ? { description: issue.description } : {}),
    ...(issue.labelIds?.length ? { labelIds: issue.labelIds } : {}),
    ...(issue.priority ? { priority: issue.priority } : {}),
    ...(issue.projectId ? { projectId: issue.projectId } : {}),
    ...(issue.stateId ? { stateId: issue.stateId } : {}),
    teamId: issue.teamId,
    title: issue.title,
  };
  const payload = await client.createIssue(issueInput);
  const createdIssue = await payload.issue;
  if (!payload.success || !createdIssue) {
    throw new Error("Linear did not create the issue.");
  }

  return {
    id: createdIssue.id,
    identifier: createdIssue.identifier,
    status: "success",
    title: createdIssue.title,
    url: createdIssue.url,
  };
};

export const listLinearIssueMetadataForUser = async (input: {
  signal?: AbortSignal;
  userId: string;
}): Promise<LinearIssueMetadataResult> =>
  await runAuthorizedConnector(
    {
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken) => await readLinearIssueMetadata(accessToken),
  );

export const listLinearIssueMetadataForCredential = async (input: {
  credentialId: string;
  signal?: AbortSignal;
  userId?: string;
}): Promise<LinearIssueMetadata> =>
  await runAuthorizedConnectorCredential(
    {
      credentialId: input.credentialId,
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken) => {
      const metadata = await readLinearIssueMetadata(accessToken);
      return {
        labels: metadata.labels,
        projects: metadata.projects,
        states: metadata.states,
        teams: metadata.teams,
        users: metadata.users,
      };
    },
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
    async (accessToken, _credential, signal) => await listLinearMcpTools(accessToken, signal),
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
      }),
  );

export const createLinearIssueForUser = async (input: {
  issue: LinearIssueCreateInput;
  signal?: AbortSignal;
  userId: string;
}): Promise<LinearIssueCreateResult> =>
  await runAuthorizedConnector(
    {
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken) => await createLinearIssue(accessToken, input.issue),
  );

export const createLinearIssueForCredential = async (input: {
  credentialId: string;
  issue: LinearIssueCreateDraft;
  signal?: AbortSignal;
  userId?: string;
}) =>
  await runAuthorizedConnectorCredential(
    {
      credentialId: input.credentialId,
      provider: LINEAR_CONNECTOR_PROVIDER,
      signal: input.signal,
      userId: input.userId,
    },
    async (accessToken) => {
      const issue = await createLinearIssue(accessToken, input.issue);
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      };
    },
  );

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
        signal,
      });

      return {
        htmlLink: event.htmlLink,
        id: event.id,
        status: "success" as const,
        summary: event.summary ?? eventDraft.summary,
      };
    },
  );
