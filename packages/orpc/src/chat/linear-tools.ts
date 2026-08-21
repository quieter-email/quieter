import {
  linearListToolsToolDef,
  linearReadToolDef,
  linearWriteToolDef,
} from "@quieter/ai/chat-agent";
import { reportError } from "@quieter/observability";

import {
  isMutatingLinearMcpTool,
  listLinearMcpToolsForUser,
  runLinearMcpToolCallsForUser,
} from "../connectors/linear-mcp";
import { hasLinearConnectorMention } from "./request";

const LINEAR_REQUEST_REQUIRED_ERROR =
  "Linear tools require an explicit @Linear request.";

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
  signal: AbortSignal;
  userId: string;
}) => {
  const isRequested = hasLinearConnectorMention(input.latestUserRequest);
  const requestGuard = () =>
    isRequested
      ? undefined
      : {
          error: LINEAR_REQUEST_REQUIRED_ERROR,
          status: "error" as const,
        };

  const listTools = linearListToolsToolDef.server(async () => {
    const guard = requestGuard();
    if (guard !== undefined) {
      return guard;
    }

    try {
      return {
        status: "success" as const,
        tools: await listLinearMcpToolsForUser({
          signal: input.signal,
          userId: input.userId,
        }),
      };
    } catch (error) {
      return getLinearToolError("list-tools", error);
    }
  });

  const callTool = async (inputCall: {
    arguments: Record<string, unknown>;
    mode: "read" | "write";
    toolName: string;
  }) => {
    const guard = requestGuard();
    if (guard !== undefined) {
      return guard;
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
        maxCalls: 1,
        signal: input.signal,
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

  const readTool = linearReadToolDef.server(
    async (inputCall) =>
      await callTool({
        arguments: inputCall.arguments ?? {},
        mode: "read",
        toolName: inputCall.toolName,
      })
  );
  const writeTool = linearWriteToolDef.server(
    async (inputCall) =>
      await callTool({
        arguments: inputCall.arguments ?? {},
        mode: "write",
        toolName: inputCall.toolName,
      })
  );

  return [listTools, readTool, ...(isRequested ? [writeTool] : [])];
};
