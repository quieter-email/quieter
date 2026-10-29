import { linearToolCallInputSchema } from "@quieter/ai/chat-agent";
import { reportError } from "@quieter/observability";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import {
  isMutatingLinearMcpTool,
  listLinearMcpToolsForUser,
  runLinearMcpToolCallsForUser,
} from "../connectors/linear-mcp";
import { getLinearConnectionForUser } from "../connectors/runtime";

const LINEAR_REQUEST_REQUIRED_ERROR =
  "Linear tools require an explicit @Linear request.";

const LINEAR_MENTION_PATTERN =
  /(?:^|[^\p{L}\p{N}_])@linear(?:$|[^\p{L}\p{N}_])/iu;

export const hasLinearConnectorMention = (text: string) =>
  LINEAR_MENTION_PATTERN.test(text);

const linearListToolsResultSchema = z.union([
  z.object({ error: z.string(), status: z.literal("error") }),
  z.object({
    connection: z.object({
      account: z.string().nullable(),
      connectionId: z.string(),
      workspace: z.string().nullable(),
    }),
    status: z.literal("success"),
    tools: z.array(
      z.object({
        description: z.string().optional(),
        inputSchema: z.unknown().optional(),
        name: z.string(),
      })
    ),
  }),
]);

const linearToolCallResultSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  output: z.unknown().optional(),
  status: z.enum(["error", "success"]),
  toolName: z.string().optional(),
});

const getLinearToolError = (operation: string, error: unknown) => {
  reportError(error, { operation: `chat:linear-${operation}` });
  return {
    error:
      "Linear could not complete that request. Check its connection and retry.",
    status: "error" as const,
  };
};

export const createLinearChatTools = (input: {
  latestUserRequest: string;
  userId: string;
}): ToolSet => {
  const isRequested = hasLinearConnectorMention(input.latestUserRequest);
  const requestGuard = () =>
    isRequested
      ? undefined
      : {
          error: LINEAR_REQUEST_REQUIRED_ERROR,
          status: "error" as const,
        };

  const callTool = async (inputCall: {
    arguments: Record<string, unknown>;
    connectionId?: string;
    mode: "read" | "write";
    signal?: AbortSignal;
    toolName: string;
  }) => {
    const guard = requestGuard();
    if (guard !== undefined) {
      return guard;
    }

    if (inputCall.mode === "write" && !inputCall.connectionId) {
      return {
        error: "Review the connected account before changing it.",
        status: "error" as const,
      };
    }

    const mutates = isMutatingLinearMcpTool({ name: inputCall.toolName });
    if (inputCall.mode === "read" && mutates) {
      return {
        error: "Use linear_write for this Linear tool.",
        status: "error" as const,
      };
    }
    if (inputCall.mode === "write" && !mutates) {
      return {
        error: "Use linear_read for this Linear tool.",
        status: "error" as const,
      };
    }

    try {
      const [result] = await runLinearMcpToolCallsForUser({
        calls: [
          {
            arguments: inputCall.arguments,
            toolName: inputCall.toolName,
          },
        ],
        connectionId: inputCall.connectionId,
        maxCalls: 1,
        signal: inputCall.signal,
        userId: input.userId,
      });
      return (
        result ?? {
          error: "Linear returned no result.",
          status: "error" as const,
        }
      );
    } catch (error) {
      return getLinearToolError("call-tool", error);
    }
  };

  const tools: ToolSet = {
    linear_list_tools: tool({
      description:
        "Discover the tools available in the connected Linear workspace. Use only after the user explicitly mentions @Linear, and use this before any other Linear tool.",
      execute: async (_input, { abortSignal }) => {
        const guard = requestGuard();
        if (guard !== undefined) {
          return guard;
        }

        try {
          const connection = await getLinearConnectionForUser(input.userId);
          return {
            connection,
            status: "success" as const,
            tools: await listLinearMcpToolsForUser({
              connectionId: connection.connectionId,
              signal: abortSignal,
              userId: input.userId,
            }),
          };
        } catch (error) {
          return getLinearToolError("list-tools", error);
        }
      },
      inputSchema: z.object({}),
      outputSchema: linearListToolsResultSchema,
    }),

    linear_read: tool({
      description:
        "Call a read-only Linear tool returned by linear_list_tools. Use this only for tool names beginning with get_, list_, or search_.",
      execute: async ({ arguments: args, toolName }, { abortSignal }) =>
        await callTool({
          arguments: args ?? {},
          mode: "read",
          signal: abortSignal,
          toolName,
        }),
      inputSchema: linearToolCallInputSchema,
      outputSchema: linearToolCallResultSchema,
    }),
  };

  if (isRequested) {
    tools.linear_write = tool({
      description:
        "Call a mutating Linear tool returned by linear_list_tools. Use this for tool names that do not begin with get_, list_, or search_.",
      execute: async (
        { arguments: args, connectionId, toolName },
        { abortSignal }
      ) =>
        await callTool({
          arguments: args ?? {},
          connectionId,
          mode: "write",
          signal: abortSignal,
          toolName,
        }),
      inputSchema: linearToolCallInputSchema.extend({
        connectionId: z.string().min(1).max(256).meta({
          description:
            "The exact connectionId returned by linear_list_tools for the reviewed account and workspace.",
        }),
      }),
      outputSchema: linearToolCallResultSchema,
    });
  }

  return tools;
};
