import type { AnyServerTool } from "@tanstack/ai";

import {
  getLinearAccessTokenForCredential,
  getLinearAccessTokenForUser,
  LINEAR_MCP_URL,
} from "./runtime";

const LINEAR_MCP_READ_PREFIXES = ["get_", "list_", "search_"];
const DEFAULT_MAX_CALLS = 4;
const DEFAULT_MAX_OUTPUT_BYTES = 8000;

const normalizeLinearMcpToolName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^linear[-_:]/u, "")
    .replace(/^linear_/u, "");

/**
 * Linear names its tools by verb, so the prefix is what separates a lookup from a
 * change. Anything that is not plainly a read is treated as mutating, which routes it
 * through the write path and its approval instead of running unattended.
 */
export const isMutatingLinearMcpTool = (tool: { name: string }) => {
  const name = normalizeLinearMcpToolName(tool.name);
  return !LINEAR_MCP_READ_PREFIXES.some((prefix) => name.startsWith(prefix));
};

/**
 * Connect to a Linear workspace over MCP.
 *
 * The client is imported on demand: it carries a JSON Schema validator that only
 * matters once a tool runs, and most work never reaches Linear at all.
 */
const connectLinearMcpClient = async (accessToken: string) => {
  const [{ createMCPClient }, { CfWorkerJsonSchemaValidator }] =
    await Promise.all([
      import("@tanstack/ai-mcp"),
      import("@modelcontextprotocol/sdk/validation/cfworker"),
    ]);

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

type LinearMcpClient = Awaited<ReturnType<typeof connectLinearMcpClient>>;

const withLinearMcpClient = async <TValue>(
  accessToken: string,
  run: (client: LinearMcpClient) => Promise<TValue>
) => {
  const client = await connectLinearMcpClient(accessToken);

  try {
    return await run(client);
  } finally {
    await client.close();
  }
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

const toDescriptor = (tool: AnyServerTool): LinearMcpToolDescriptor => ({
  ...(typeof tool.description === "string"
    ? { description: tool.description }
    : {}),
  inputSchema: tool.inputSchema,
  name: tool.name,
});

/**
 * A tool result goes into a model's context, so an unbounded one would crowd out the
 * conversation it is meant to inform. Oversized output is reported as a string rather
 * than dropped, so the model can still act on the part that fits.
 */
const truncateToolOutput = (output: unknown, maxOutputBytes: number) => {
  const serialized = JSON.stringify(output) ?? "";
  if (serialized.length <= maxOutputBytes) {
    return output;
  }

  return {
    truncated: true,
    value: serialized.slice(0, maxOutputBytes),
  };
};

const callTool = async (input: {
  client: LinearMcpClient;
  call: LinearMcpToolCallInput;
  maxOutputBytes: number;
  tools: Map<string, AnyServerTool>;
}): Promise<LinearMcpToolCallResult> => {
  const startedAt = Date.now();
  const base = {
    ...(input.call.arguments ? { arguments: input.call.arguments } : {}),
    toolName: input.call.toolName,
  };
  const tool = input.tools.get(input.call.toolName);

  if (tool?.execute === undefined) {
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      error: `Linear does not offer a tool named ${input.call.toolName}.`,
      status: "error",
    };
  }

  try {
    const output: unknown = await tool.execute(input.call.arguments ?? {});
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      output: truncateToolOutput(output, input.maxOutputBytes),
      status: "success",
    };
  } catch (error) {
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Tool call failed.",
      status: "error",
    };
  }
};

/**
 * One at a time on purpose: the calls a model batches usually build on each other,
 * and one workspace should not field a burst of parallel writes.
 */
const callToolsSequentially = async (input: {
  calls: LinearMcpToolCallInput[];
  client: LinearMcpClient;
  maxOutputBytes: number;
  tools: Map<string, AnyServerTool>;
}): Promise<LinearMcpToolCallResult[]> => {
  const [call, ...remaining] = input.calls;
  if (call === undefined) {
    return [];
  }

  const result = await callTool({ ...input, call });
  return [
    result,
    ...(await callToolsSequentially({ ...input, calls: remaining })),
  ];
};

const runLinearMcpToolCalls = async (input: {
  accessToken: string;
  calls: LinearMcpToolCallInput[];
  maxCalls?: number;
  maxOutputBytes?: number;
}): Promise<LinearMcpToolCallResult[]> =>
  await withLinearMcpClient(input.accessToken, async (client) => {
    const discovered = await client.tools();

    return await callToolsSequentially({
      calls: input.calls.slice(0, input.maxCalls ?? DEFAULT_MAX_CALLS),
      client,
      maxOutputBytes: input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      tools: new Map(discovered.map((tool) => [tool.name, tool])),
    });
  });

export const listLinearMcpToolsForCredential = async (input: {
  credentialId: string;
  signal?: AbortSignal;
  userId?: string;
}): Promise<LinearMcpToolDescriptor[]> => {
  const accessToken = await getLinearAccessTokenForCredential(input);
  return await withLinearMcpClient(accessToken, async (client) => {
    const tools = await client.tools();
    return tools.map(toDescriptor);
  });
};

export const runLinearMcpToolCallsForCredential = async (input: {
  calls: LinearMcpToolCallInput[];
  credentialId: string;
  maxCalls?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  userId?: string;
}): Promise<LinearMcpToolCallResult[]> => {
  const accessToken = await getLinearAccessTokenForCredential(input);
  return await runLinearMcpToolCalls({ ...input, accessToken });
};

/**
 * Expose the user's Linear workspace to chat as a tool source.
 *
 * Satisfies the shape `chat({ mcp })` expects, so discovery and dispatch stay inside
 * the agent loop and the workspace decides which tools exist. A change to that
 * workspace is the user's to approve, and a tool's own name is what marks it.
 */
export const createLinearMcpToolSource = (context: { userId: string }) => {
  let client: LinearMcpClient | null = null;

  return {
    close: async () => {
      await client?.close();
      client = null;
    },
    tools: async (): Promise<AnyServerTool[]> => {
      client ??= await connectLinearMcpClient(
        await getLinearAccessTokenForUser(context)
      );
      const tools = await client.tools();

      return tools.map((tool) => ({
        ...tool,
        needsApproval: isMutatingLinearMcpTool(tool),
      }));
    },
  };
};
