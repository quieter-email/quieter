import {
  createMcpHandler,
  McpServer,
  ProtocolError,
} from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import { controlContracts } from "@quieter/orpc/control/contracts";
import {
  CONTROL_API_VERSION,
  CONTROL_API_VERSION_HEADER,
} from "@quieter/orpc/control/openapi";
import { controlTargetSchema } from "@quieter/orpc/control/registry";
import type { ControlTarget } from "@quieter/orpc/control/registry";
import {
  controlReadOperationIdSchema,
  createControlReadRuntime,
} from "@quieter/orpc/control/runtime";
import type {
  ControlReadRuntime,
  ControlRequestContext,
} from "@quieter/orpc/control/runtime";
import { z } from "zod";

export const MANAGEMENT_MCP_TARGET_HEADER = "Quieter-Control-Target";

type ManagementTarget = Exclude<ControlTarget, { kind: "organization" }>;
type ManagementMcpOptions = {
  reportError?: (error: Error) => void;
  runtime?: ControlReadRuntime;
  scheduleBackgroundTask?: (task: Promise<unknown>) => void;
};

const runtime = createControlReadRuntime();
const maxRequestBytes = 64 * 1024;
const descriptions = {
  "calendar.accounts": "List accessible calendar accounts.",
  "calendar.event": "Read one event in the selected calendar account.",
  "calendar.events": "Read events in the selected calendar account.",
  "calendar.list": "List calendars in the selected calendar account.",
  "mail.read_thread": "Read a thread in the selected mailbox.",
  "mail.search": "Search the selected mailbox with optional paging.",
  "mailboxes.list": "List accessible mailboxes.",
} satisfies Record<z.infer<typeof controlReadOperationIdSchema>, string>;

const publicFailures = {
  BAD_REQUEST: { message: "Invalid management request.", status: 400 },
  CANCELLED: { message: "The request was cancelled.", status: 499 },
  CONFLICT: {
    message: "The request conflicts with the current state. Try again.",
    status: 409,
  },
  FORBIDDEN: {
    message: "You do not have access to this operation.",
    status: 403,
  },
  NOT_FOUND: {
    message: "The requested resource is not available.",
    status: 404,
  },
  RATE_LIMITED: {
    message: "Too many requests. Try again shortly.",
    status: 429,
  },
  REAUTHENTICATION_REQUIRED: {
    message: "Reconnect the selected account to continue.",
    status: 401,
  },
  UNAUTHORIZED: {
    message: "Sign in or reconnect the selected account to continue.",
    status: 401,
  },
  UNSUPPORTED_OPERATION: {
    message: "This management operation is not available.",
    status: 404,
  },
};

const managementFailure = (input: {
  context: ControlRequestContext;
  error: unknown;
  reportError: ManagementMcpOptions["reportError"];
}) => {
  let code: unknown =
    input.error instanceof ORPCError ? input.error.code : undefined;
  if (input.context.signal?.aborted === true) {
    code = "CANCELLED";
  } else if (code === "TOO_MANY_REQUESTS") {
    code = "RATE_LIMITED";
  } else if (code === "MAILBOX_SCOPE_REPAIR_REQUIRED") {
    code = "REAUTHENTICATION_REQUIRED";
  }
  const expected = Object.entries(publicFailures).find(
    ([candidate]) => candidate === code
  );
  if (expected !== undefined) {
    const [publicCode, failure] = expected;
    const retry = Number(input.context.responseHeaders?.get("retry-after"));
    const retryAfterMs =
      input.context.responseHeaders?.has("retry-after") === true &&
      Number.isFinite(retry) &&
      retry >= 0
        ? Math.ceil(retry * 1000)
        : undefined;
    const status =
      input.error instanceof ORPCError &&
      (input.error.status === 413 || input.error.status === 415)
        ? input.error.status
        : failure.status;
    return {
      error: { code: publicCode, message: failure.message, retryAfterMs },
      status,
    };
  }
  input.reportError?.(new Error("Unexpected management MCP request failure."));
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "The request failed. Try again shortly.",
    },
    status: 500,
  };
};

const readManagementJson = async (request: Request): Promise<unknown> => {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  ) {
    throw new ORPCError("BAD_REQUEST", { status: 415 });
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > maxRequestBytes
  ) {
    throw new ORPCError("BAD_REQUEST", { status: 413 });
  }
  if (request.body === null) {
    throw new ORPCError("BAD_REQUEST");
  }
  const reader = request.body.getReader();
  const cancelRead = () => {
    // oxlint-disable-next-line promise/prefer-await-to-then, eslint/no-empty-function -- Abort cleanup must not replace the request cancellation.
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener("abort", cancelRead, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      request.signal.throwIfAborted();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > maxRequestBytes) {
        await reader.cancel();
        throw new ORPCError("BAD_REQUEST", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    request.signal.removeEventListener("abort", cancelRead);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    return body;
  } catch {
    throw new ORPCError("BAD_REQUEST");
  }
};

const buildManagementMcpServer = (input: {
  context: ControlRequestContext;
  executor: ControlReadRuntime;
  reportError: ManagementMcpOptions["reportError"];
  target: ManagementTarget;
}): McpServer => {
  const server = new McpServer(
    {
      name: "quieter-management",
      title: "Quieter Management",
      version: "1.0.0",
    },
    {
      instructions:
        "Read current authorized mail and calendar information. Discover the selected target's operations, request their schemas when needed, then run an operation with its complete input. User targets only discover mailboxes and calendar accounts. Mailbox targets pin an organization and mailbox. Calendar targets pin an account connection and allow calendars within that account. This server cannot make changes, read availability, settings, or personal memory, or send transactional mail.",
    }
  );
  const discover = async () => {
    const discovery = await input.executor.discover({
      context: input.context,
      target: input.target,
    });
    return discovery.operations.flatMap((operation) => {
      const selected = controlReadOperationIdSchema.safeParse(operation.id);
      return selected.success &&
        operation.effect.kind === "read" &&
        operation.target === input.target.kind
        ? [{ ...operation, id: selected.data }]
        : [];
    });
  };
  const toolFailure = (error: unknown): CallToolResult => {
    const failure = managementFailure({ ...input, error });
    const structuredContent = { error: failure.error };
    return {
      content: [{ text: JSON.stringify(structuredContent), type: "text" }],
      isError: true,
      structuredContent,
    };
  };
  const annotations = {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  };
  server.registerTool(
    "discover_operations",
    {
      annotations,
      description:
        "List the selected target's currently authorized read operations. Returns compact metadata by default. Supply schemaOperationIds to load the exact shared input and output JSON schemas for those operations. Schemas describe complete parameters, including the pinned target identifiers.",
      inputSchema: z.strictObject({
        schemaOperationIds: z.array(controlReadOperationIdSchema).optional(),
      }),
      title: "Discover management operations",
    },
    async ({ schemaOperationIds = [] }): Promise<CallToolResult> => {
      try {
        const operations = await discover();
        if (
          schemaOperationIds.some(
            (id) => !operations.some((operation) => operation.id === id)
          )
        ) {
          throw new ORPCError("UNSUPPORTED_OPERATION", { status: 404 });
        }
        const structuredContent = {
          operations: operations.map((operation) => ({
            ...operation,
            description: descriptions[operation.id],
            ...(schemaOperationIds.includes(operation.id)
              ? {
                  inputSchema: z.toJSONSchema(
                    controlContracts[operation.id].input,
                    { io: "input" }
                  ),
                  outputSchema: z.toJSONSchema(
                    controlContracts[operation.id].output
                  ),
                }
              : {}),
          })),
        };
        return {
          content: [{ text: JSON.stringify(structuredContent), type: "text" }],
          structuredContent,
        };
      } catch (error) {
        return toolFailure(error);
      }
    }
  );
  server.registerTool(
    "run_operation",
    {
      annotations,
      description:
        "Run one currently authorized read operation using its complete shared input. Discover its schema first. Parameters must match the selected target's mailbox and organization or calendar account connection. Returns the current application result, including mail source links and paging metadata.",
      inputSchema: z.strictObject({
        operation: controlReadOperationIdSchema,
        parameters: z.unknown(),
      }),
      title: "Read management information",
    },
    async ({ operation, parameters }): Promise<CallToolResult> => {
      try {
        const operations = await discover();
        if (!operations.some((candidate) => candidate.id === operation)) {
          throw new ORPCError("UNSUPPORTED_OPERATION", { status: 404 });
        }
        const parsed = controlContracts[operation].input.safeParse(parameters);
        if (!parsed.success) {
          throw new ORPCError("BAD_REQUEST");
        }
        const values = parsed.data;
        if (
          (input.target.kind === "mailbox" &&
            (!("mailboxId" in values) ||
              !("organizationId" in values) ||
              values.mailboxId !== input.target.mailboxId ||
              values.organizationId !== input.target.organizationId)) ||
          (input.target.kind === "calendar" &&
            (!("connectionId" in values) ||
              values.connectionId !== input.target.connectionId))
        ) {
          throw new ORPCError("FORBIDDEN");
        }
        const result = await input.executor.execute({
          context: input.context,
          operation,
          parameters: values,
        });
        const structuredContent = { operation, result };
        return {
          content: [{ text: JSON.stringify(structuredContent), type: "text" }],
          structuredContent,
        };
      } catch (error) {
        return toolFailure(error);
      }
    }
  );
  return server;
};

const expectedTransportErrorPrefixes = [
  "Bad Request",
  "Conflict",
  "Failed to write to the response stream",
  "Invalid Request",
  "Method not allowed",
  "Not Acceptable",
  "Parse error",
  "Rejected inbound request",
  "Rejected 2025-era request",
  "Session not found",
  "subscriptions/listen refused",
  "Unsupported Media Type",
  "Unsupported protocol version",
];

export const handleManagementMcpRequest = async (
  request: Request,
  options: ManagementMcpOptions = {}
): Promise<Response> => {
  const headers = new Headers({
    "cache-control": "private, no-store",
    [CONTROL_API_VERSION_HEADER]: CONTROL_API_VERSION,
  });
  const context: ControlRequestContext = {
    headers: new Headers(request.headers),
    responseHeaders: headers,
    scheduleBackgroundTask: options.scheduleBackgroundTask,
    signal: request.signal,
  };
  try {
    request.signal.throwIfAborted();
    if (
      request.headers.get(CONTROL_API_VERSION_HEADER)?.trim() !==
      CONTROL_API_VERSION
    ) {
      throw new ORPCError("BAD_REQUEST");
    }
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== new URL(request.url).origin) {
      throw new ORPCError("FORBIDDEN");
    }
    if (request.method !== "POST") {
      headers.set("allow", "POST");
      return Response.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "This request method is not supported.",
          },
        },
        { headers, status: 405 }
      );
    }
    let rawTarget: unknown;
    try {
      rawTarget = JSON.parse(
        request.headers.get(MANAGEMENT_MCP_TARGET_HEADER) ?? ""
      );
    } catch {
      throw new ORPCError("BAD_REQUEST");
    }
    const selected = controlTargetSchema.safeParse(rawTarget);
    if (!selected.success) {
      throw new ORPCError("BAD_REQUEST");
    }
    if (selected.data.kind === "organization") {
      throw new ORPCError("UNSUPPORTED_OPERATION", { status: 404 });
    }
    const target = selected.data;
    const executor = options.runtime ?? runtime;
    await executor.discover({ context, target });
    const parsedBody = await readManagementJson(request);
    const handler = createMcpHandler(
      () =>
        buildManagementMcpServer({
          context,
          executor,
          reportError: options.reportError,
          target,
        }),
      {
        maxRequestBodySize: maxRequestBytes,
        // This endpoint buffers single exchanges and must never retain a subscription stream.
        maxSubscriptions: 0,
        onerror: (error) => {
          if (
            !(error instanceof ProtocolError) &&
            !(error instanceof SyntaxError) &&
            !(error instanceof z.ZodError) &&
            !expectedTransportErrorPrefixes.some((prefix) =>
              error.message.startsWith(prefix)
            )
          ) {
            options.reportError?.(
              new Error("Unexpected management MCP transport failure.")
            );
          }
        },
      }
    );
    try {
      const response = await handler.fetch(request, { parsedBody });
      // Buffer the single exchange so session refresh and retry headers set by reads reach the client.
      const body = await response.arrayBuffer();
      request.signal.throwIfAborted();
      const responseHeaders = new Headers(response.headers);
      for (const [name, value] of headers) {
        responseHeaders.set(name, value);
      }
      return new Response(body.byteLength === 0 ? null : body, {
        headers: responseHeaders,
        status: response.status,
        statusText: response.statusText,
      });
    } finally {
      await handler.close();
    }
  } catch (error) {
    const failure = managementFailure({
      context,
      error,
      reportError: options.reportError,
    });
    return Response.json(
      { error: failure.error },
      { headers, status: failure.status }
    );
  }
};
