import { googleCalendarCreateEventInputSchema } from "@quieter/ai/chat-agent";
import type { ConnectorProvider } from "@quieter/database/schema";
import type { JSONSchema } from "@tanstack/ai";
import { z } from "zod";

import {
  isMutatingLinearMcpTool,
  listLinearMcpToolsForCredential,
  runLinearMcpToolCallsForCredential,
} from "./linear-mcp";
import { createGoogleCalendarEventForCredential } from "./runtime";

/**
 * One tool a connector exposes to a mailbox action. `mutates` decides whether
 * the executor has to guard the call with an idempotency record, so it is the
 * only thing the action layer needs to know about a connector's capabilities.
 */
export type ConnectorAgentTool = {
  description?: string;
  inputSchema: JSONSchema;
  mutates: boolean;
  name: string;
};

/**
 * An MCP server describes its tools with schemas we never author, so they
 * arrive untyped. They are passed to the model as-is; anything that is not an
 * object becomes a permissive schema and the provider validates the call.
 */
const asJsonSchema = (value: unknown): JSONSchema =>
  typeof value === "object" && value !== null
    ? value
    : { additionalProperties: true, type: "object" };

/**
 * A write is recorded against whatever it created, so the action layer can link to it
 * later. MCP results are server-shaped, so the identifiers are read defensively and
 * simply left out when the tool does not report them.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getLinearMcpResultReference = (output: unknown) => {
  if (!isRecord(output)) {
    return {};
  }

  return {
    ...(typeof output.id === "string" ? { externalId: output.id } : {}),
    ...(typeof output.url === "string" ? { externalUrl: output.url } : {}),
  };
};

export type ConnectorAgentToolCall = {
  arguments?: Record<string, unknown>;
  toolName: string;
};

export type ConnectorAgentToolResult = {
  durationMs: number;
  error?: string;
  externalId?: string;
  externalUrl?: string;
  output?: unknown;
  status: "error" | "success";
  toolName: string;
};

type ConnectorCredentialInput = {
  credentialId: string;
  signal?: AbortSignal;
  userId?: string;
};

/** A provider whose tools are static does not need to reach the network. */
type Awaitable<TValue> = Promise<TValue> | TValue;

type ConnectorAgentAdapter = {
  listTools: (
    input: ConnectorCredentialInput
  ) => Awaitable<ConnectorAgentTool[]>;
  /** Read-only calls, batched so a provider can reuse one session. */
  runReadCalls: (
    input: ConnectorCredentialInput & { calls: ConnectorAgentToolCall[] }
  ) => Awaitable<ConnectorAgentToolResult[]>;
  /** A single mutating call. The executor wraps this in an effect record. */
  runWriteCall: (
    input: ConnectorCredentialInput & { call: ConnectorAgentToolCall }
  ) => Awaitable<ConnectorAgentToolResult>;
};

export const GOOGLE_CALENDAR_CREATE_EVENT_TOOL = "create_google_calendar_event";

const toJsonSchema = (schema: z.ZodType) =>
  asJsonSchema(z.toJSONSchema(schema, { io: "input", target: "draft-7" }));

const failedCall = (
  call: ConnectorAgentToolCall,
  error: string
): ConnectorAgentToolResult => ({
  durationMs: 0,
  error,
  status: "error",
  toolName: call.toolName,
});

const timed = async (
  call: ConnectorAgentToolCall,
  run: () => Promise<Omit<ConnectorAgentToolResult, "durationMs" | "toolName">>
): Promise<ConnectorAgentToolResult> => {
  const startedAt = Date.now();

  try {
    const result = await run();
    return {
      ...result,
      durationMs: Date.now() - startedAt,
      toolName: call.toolName,
    };
  } catch (error) {
    return {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Tool call failed.",
      status: "error",
      toolName: call.toolName,
    };
  }
};

const linearAdapter: ConnectorAgentAdapter = {
  listTools: async (input) => {
    const tools = await listLinearMcpToolsForCredential(input);

    return tools.map((tool) => ({
      description: tool.description,
      inputSchema: asJsonSchema(tool.inputSchema),
      mutates: isMutatingLinearMcpTool(tool),
      name: tool.name,
    }));
  },
  runReadCalls: async (input) => {
    const results = await runLinearMcpToolCallsForCredential({
      calls: input.calls,
      credentialId: input.credentialId,
      signal: input.signal,
      userId: input.userId,
    });

    return results.map((result) => ({
      durationMs: result.durationMs,
      error: result.error,
      output: result.output,
      status: result.status,
      toolName: result.toolName,
    }));
  },
  // Writes take the same MCP path as reads; only the approval around them differs.
  runWriteCall: async (input) =>
    await timed(input.call, async () => {
      const [result] = await runLinearMcpToolCallsForCredential({
        calls: [input.call],
        credentialId: input.credentialId,
        maxCalls: 1,
        signal: input.signal,
        userId: input.userId,
      });

      if (result === undefined || result.status === "error") {
        throw new Error(result?.error ?? "Linear rejected the change.");
      }

      const reference = getLinearMcpResultReference(result.output);
      return {
        ...reference,
        output: result.output,
        status: "success" as const,
      };
    }),
};

const googleCalendarAdapter: ConnectorAgentAdapter = {
  listTools: () => [
    {
      description:
        "Create one event on the connected Google Calendar. Use the timezone stated in the mail when there is one.",
      inputSchema: toJsonSchema(googleCalendarCreateEventInputSchema),
      mutates: true,
      name: GOOGLE_CALENDAR_CREATE_EVENT_TOOL,
    },
  ],
  runReadCalls: (input) =>
    input.calls.map((call) =>
      failedCall(call, "Google Calendar has no read tools.")
    ),
  runWriteCall: async (input) =>
    await timed(input.call, async () => {
      const event = await createGoogleCalendarEventForCredential({
        credentialId: input.credentialId,
        event: googleCalendarCreateEventInputSchema.parse(
          input.call.arguments ?? {}
        ),
        signal: input.signal,
        userId: input.userId,
      });

      return {
        externalId: event.id,
        externalUrl: event.htmlLink,
        output: event,
        status: "success" as const,
      };
    }),
};

const adapters = {
  google_calendar: googleCalendarAdapter,
  linear: linearAdapter,
} as const satisfies Record<ConnectorProvider, ConnectorAgentAdapter>;

export const listConnectorAgentTools = async (
  input: ConnectorCredentialInput & { provider: ConnectorProvider }
) => await adapters[input.provider].listTools(input);

export const runConnectorAgentReadCalls = async (
  input: ConnectorCredentialInput & {
    calls: ConnectorAgentToolCall[];
    provider: ConnectorProvider;
  }
) =>
  input.calls.length === 0
    ? []
    : await adapters[input.provider].runReadCalls(input);

export const runConnectorAgentWriteCall = async (
  input: ConnectorCredentialInput & {
    call: ConnectorAgentToolCall;
    provider: ConnectorProvider;
  }
) => await adapters[input.provider].runWriteCall(input);
