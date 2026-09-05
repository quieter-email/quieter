import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";
import { serverEnv } from "@quieter/env/server";
import { z } from "zod";

import {
  getLinearAccessTokenForCredential,
  getLinearAccessTokenForUser,
  LINEAR_MCP_URL,
} from "./runtime";

const LINEAR_MCP_READ_PREFIXES = ["get_", "list_", "search_"];
const MCP_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CALLS = 4;
const DEFAULT_MAX_OUTPUT_BYTES = 8000;

// Workers extend fetch with preconnect for subrequest connection warming; the
// Node runtime leaves it unset, so it stays optional here.
type PreconnectableFetch = typeof fetch & {
  preconnect?: (url: string | URL) => void;
};
const workersFetch: PreconnectableFetch = fetch;

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
 * Connecting and tool discovery take no signal of their own, but every request the
 * client makes goes through this fetch, so cancellation and a ceiling are applied
 * here instead. Without it a stalled Linear holds the caller open indefinitely.
 */
const createBoundedFetch = (signal?: AbortSignal): typeof fetch =>
  Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const signals = [AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS)];
      if (signal !== undefined) {
        signals.push(signal);
      }
      if (init?.signal) {
        signals.push(init.signal);
      }

      return await fetch(input, { ...init, signal: AbortSignal.any(signals) });
    },
    { preconnect: workersFetch.preconnect }
  );
/**
 * Connect to a Linear workspace over MCP. The AI SDK MCP client wraps tool
 * schemas without compiling them, so no evaluator has to run in Workers.
 */
const connectLinearMcpClient = async (
  accessToken: string,
  signal?: AbortSignal
): Promise<MCPClient> =>
  await createMCPClient({
    transport: {
      fetch: createBoundedFetch(signal),
      headers: { Authorization: `Bearer ${accessToken}` },
      type: "http",
      url: LINEAR_MCP_URL,
    },
  });

const withLinearMcpClient = async <TValue>(
  input: { accessToken: string; signal?: AbortSignal },
  run: (client: MCPClient) => Promise<TValue>
) => {
  const client = await connectLinearMcpClient(input.accessToken, input.signal);

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

/**
 * A tool result goes into a model's context, so an unbounded one would crowd out the
 * conversation it is meant to inform. Oversized output is reported as a string rather
 * than dropped, so the model can still act on the part that fits.
 */
const linearMcpErrorTextSchema = z.looseObject({
  text: z.string(),
  type: z.literal("text"),
});

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
  call: LinearMcpToolCallInput;
  client: MCPClient;
  maxOutputBytes: number;
}): Promise<LinearMcpToolCallResult> => {
  const startedAt = Date.now();
  const base = {
    ...(input.call.arguments ? { arguments: input.call.arguments } : {}),
    toolName: input.call.toolName,
  };

  try {
    if (
      serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
      (serverEnv.QUIETER_LOCAL_PROVIDER_MODE !== "write" ||
        serverEnv.QUIETER_LOCAL_LINEAR_WRITES !== true) &&
      isMutatingLinearMcpTool({ name: input.call.toolName })
    ) {
      throw new Error(
        "This development environment can read connected accounts, but cannot change them."
      );
    }
    const output: unknown = await input.client.callTool({
      arguments: input.call.arguments ?? {},
      name: input.call.toolName,
    });
    // MCP reports in-band tool failures through isError instead of the
    // transport rejecting, so a resolved result can still be an error.
    if (
      typeof output === "object" &&
      output !== null &&
      "isError" in output &&
      output.isError === true
    ) {
      const contentItems =
        "content" in output && Array.isArray(output.content)
          ? output.content
          : [];
      const detail = contentItems
        .flatMap((item) => {
          const parsed = linearMcpErrorTextSchema.safeParse(item);
          return parsed.success ? [parsed.data.text] : [];
        })
        .join("\n")
        .slice(0, 500);
      return {
        ...base,
        durationMs: Date.now() - startedAt,
        error: detail === "" ? "The Linear tool reported an error." : detail,
        status: "error",
      };
    }
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
  client: MCPClient;
  maxOutputBytes: number;
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
  signal?: AbortSignal;
}): Promise<LinearMcpToolCallResult[]> =>
  await withLinearMcpClient(
    input,
    async (client) =>
      await callToolsSequentially({
        calls: input.calls.slice(0, input.maxCalls ?? DEFAULT_MAX_CALLS),
        client,
        maxOutputBytes: input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      })
  );

export const listLinearMcpToolsForCredential = async (input: {
  credentialId: string;
  signal?: AbortSignal;
  userId?: string;
}): Promise<LinearMcpToolDescriptor[]> => {
  const accessToken = await getLinearAccessTokenForCredential(input);
  return await withLinearMcpClient(
    { accessToken, signal: input.signal },
    async (client) => {
      const { tools } = await client.listTools();
      return tools.map((tool) => ({
        ...(tool.description === undefined
          ? {}
          : { description: tool.description }),
        ...(tool.inputSchema === undefined
          ? {}
          : { inputSchema: tool.inputSchema }),
        name: tool.name,
      }));
    }
  );
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

export const listLinearMcpToolsForUser = async (input: {
  signal?: AbortSignal;
  userId: string;
}): Promise<LinearMcpToolDescriptor[]> => {
  const accessToken = await getLinearAccessTokenForUser(input);
  return await withLinearMcpClient(
    { accessToken, signal: input.signal },
    async (client) => {
      const { tools } = await client.listTools();
      return tools.map((tool) => ({
        ...(tool.description === undefined
          ? {}
          : { description: tool.description }),
        ...(tool.inputSchema === undefined
          ? {}
          : { inputSchema: tool.inputSchema }),
        name: tool.name,
      }));
    }
  );
};

export const runLinearMcpToolCallsForUser = async (input: {
  calls: LinearMcpToolCallInput[];
  maxCalls?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  userId: string;
}): Promise<LinearMcpToolCallResult[]> => {
  const accessToken = await getLinearAccessTokenForUser(input);
  return await runLinearMcpToolCalls({ ...input, accessToken });
};
