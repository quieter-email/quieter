import type { AnyServerTool } from "@tanstack/ai";

import {
  getLinearAccessTokenForUser,
  isMutatingLinearMcpTool,
  LINEAR_MCP_URL,
} from "./runtime";

/**
 * Connect to the user's Linear workspace over MCP.
 *
 * The MCP client is loaded on demand: it carries a JSON Schema validator that only
 * matters once a tool actually runs, and most chat turns never reach Linear at all.
 */
const connectLinearMcpClient = async (userId: string) => {
  const [{ createMCPClient }, { CfWorkerJsonSchemaValidator }] =
    await Promise.all([
      import("@tanstack/ai-mcp"),
      import("@modelcontextprotocol/sdk/validation/cfworker"),
    ]);
  const accessToken = await getLinearAccessTokenForUser({ userId });

  return await createMCPClient({
    clientOptions: {
      // The default validator compiles schemas with `new Function`, which Workers
      // forbid, so every tool declaring an output schema would fail there.
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    },
    transport: {
      headers: { Authorization: `Bearer ${accessToken}` },
      type: "http",
      url: LINEAR_MCP_URL,
    },
  });
};

/**
 * Expose the user's Linear workspace to chat as a tool source.
 *
 * Satisfies the shape `chat({ mcp })` expects, so discovery and dispatch stay inside
 * the agent loop and the workspace decides which tools exist. A change to that
 * workspace is the user's to approve, and Linear names its mutations by verb, so a
 * tool's own name is what marks it.
 */
export const createLinearMcpToolSource = (context: { userId: string }) => {
  let client: Awaited<ReturnType<typeof connectLinearMcpClient>> | null = null;

  return {
    close: async () => {
      await client?.close();
      client = null;
    },
    tools: async (): Promise<AnyServerTool[]> => {
      client ??= await connectLinearMcpClient(context.userId);
      const tools = await client.tools();

      return tools.map((tool) => ({
        ...tool,
        needsApproval: isMutatingLinearMcpTool({ name: tool.name }),
      }));
    },
  };
};
