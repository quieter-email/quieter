import type { AnyServerTool } from "@tanstack/ai";

import {
  isMutatingLinearMcpTool,
  listLinearMcpToolsForUser,
  runLinearMcpToolCallsForUser,
} from "./runtime";
import type { LinearMcpToolDescriptor } from "./runtime";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * An MCP server describes its tools with schemas we never author, so they arrive as
 * plain JSON Schema. Chat accepts that directly, so the descriptor is passed through
 * rather than translated; anything that is not an object becomes permissive and the
 * server validates the call.
 */
const asToolInputSchema = (value: unknown) =>
  isRecord(value) ? value : { additionalProperties: true, type: "object" };

const toServerTool = (
  tool: LinearMcpToolDescriptor,
  context: { signal?: AbortSignal; userId: string }
): AnyServerTool => ({
  __toolSide: "server",
  description: tool.description ?? `Linear ${tool.name}.`,
  execute: async (args: unknown) => {
    const [result] = await runLinearMcpToolCallsForUser({
      calls: [
        {
          arguments: isRecord(args) ? args : {},
          toolName: tool.name,
        },
      ],
      maxCalls: 1,
      signal: context.signal,
      userId: context.userId,
    });

    if (result === undefined) {
      return { error: "Linear did not answer.", status: "error" };
    }
    if (result.status === "error") {
      return {
        error: result.error ?? "Linear rejected the call.",
        status: "error",
      };
    }

    return { result: result.output, status: "success" };
  },
  inputSchema: asToolInputSchema(tool.inputSchema),
  name: tool.name,
  // A change to the user's workspace is theirs to approve, and Linear names its
  // mutations by verb, so the tool's own name is what decides.
  needsApproval: isMutatingLinearMcpTool(tool),
});

/**
 * Expose the user's Linear workspace to chat over their own MCP connection.
 *
 * Satisfies the `MCPToolSource` shape `chat({ mcp })` expects, so tool discovery and
 * dispatch stay in the agent loop instead of being mirrored into hand-written tools.
 * The connection is per user and short-lived, so there is nothing to close.
 */
export const createLinearMcpToolSource = (context: {
  signal?: AbortSignal;
  userId: string;
}) => ({
  close: async () => {
    // Each call opens its own short-lived session, so nothing is held open here.
    await Promise.resolve();
  },
  tools: async (): Promise<AnyServerTool[]> => {
    const tools = await listLinearMcpToolsForUser(context);
    return tools.map((tool) => toServerTool(tool, context));
  },
});
