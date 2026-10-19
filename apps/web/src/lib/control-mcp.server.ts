import {
  createMcpHandler,
  McpServer,
  ProtocolError,
} from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import {
  controlOperations,
  controlOperationSchema,
} from "@quieter/mail/control";
import type { GrowthActor } from "@quieter/orpc/growth-access";
import { z } from "zod";

import { getOrganizationApiKeyAccess } from "./organization-api-auth.server";
import { reportServerError } from "./server-error-reporting";

export const buildControlMcpServer = (actor: GrowthActor): McpServer => {
  const server = new McpServer(
    {
      name: "quieter-management",
      title: "Quieter audiences and campaigns",
      version: "1.0.0",
    },
    {
      instructions:
        "Manage the authenticated team's audiences and broadcast campaigns. Only tools authorized by this API key are listed. Read recipient eligibility, exclusions, estimated cost and the current draft before asking the user to confirm a send. Never invent consent or clear safety suppression to make a send succeed. Preserve idempotency keys across retries.",
    }
  );
  for (const [operationName, contract] of Object.entries(controlOperations)) {
    const operation = controlOperationSchema.parse(operationName);
    const inputSchema: z.ZodObject = contract.input;
    if (actor.scopes !== undefined && !actor.scopes.includes(contract.scope)) {
      continue;
    }
    const readOnly = contract.scope.endsWith(":read");
    server.registerTool(
      operation.replaceAll(".", "_"),
      {
        annotations: {
          destructiveHint: !readOnly,
          idempotentHint: readOnly || "idempotencyKey" in contract.input.shape,
          openWorldHint: operation === "campaigns.send",
          readOnlyHint: readOnly,
        },
        description: contract.description,
        inputSchema,
        outputSchema: z.object({ result: contract.output }),
        title: operation,
      },
      async (args: Record<string, unknown>) => {
        try {
          const { executeControlOperation } =
            await import("@quieter/orpc/control");
          const result = await executeControlOperation(actor, operation, args);
          return {
            content: [{ text: JSON.stringify(result), type: "text" }],
            structuredContent: { result },
          };
        } catch (error) {
          if (error instanceof ORPCError && error.status < 500) {
            return {
              content: [{ text: error.message, type: "text" }],
              isError: true,
            };
          }
          reportServerError(error, "management-mcp-tool");
          return {
            content: [
              {
                text: "Could not complete this action. Try again.",
                type: "text",
              },
            ],
            isError: true,
          };
        }
      }
    );
  }
  return server;
};

const handler = createMcpHandler(
  (context) => {
    const actor = z
      .object({
        apiKeyId: z.string(),
        organizationId: z.string(),
        scopes: z.array(
          z.enum([
            "audiences:read",
            "audiences:write",
            "campaigns:read",
            "campaigns:write",
            "campaigns:send",
            "templates:read",
            "templates:write",
          ])
        ),
      })
      .parse(context.authInfo?.extra);
    return buildControlMcpServer(actor);
  },
  {
    onerror: (error) => {
      if (
        !(error instanceof ProtocolError) &&
        !(error instanceof SyntaxError) &&
        !(error instanceof z.ZodError)
      ) {
        reportServerError(error, "management-mcp");
      }
    },
  }
);

export const handleControlMcpRequest = async (
  request: Request
): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: { allow: "POST, GET, DELETE, OPTIONS" },
      status: 204,
    });
  }
  try {
    const actor = await getOrganizationApiKeyAccess(request);
    if (actor === null) {
      return Response.json(
        { error: "Unauthorized" },
        {
          headers: { "www-authenticate": 'Bearer realm="quieter-management"' },
          status: 401,
        }
      );
    }
    if (actor.scopes.length === 0) {
      return Response.json(
        { error: "This key has no audience or campaign permissions." },
        { status: 403 }
      );
    }
    let boundedRequest = request;
    if (request.body !== null) {
      const { readLimitedRequestText } =
        await import("./unsubscribe-request.server");
      const body = await readLimitedRequestText(request, 1024 * 1024);
      boundedRequest = new Request(request.url, {
        body,
        headers: request.headers,
        method: request.method,
        signal: request.signal,
      });
    }
    return await handler.fetch(boundedRequest, {
      authInfo: {
        clientId: actor.apiKeyId,
        extra: actor,
        scopes: actor.scopes,
        token: "organization-api-key",
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return Response.json(
        { error: "Request body is too large." },
        { status: 413 }
      );
    }
    reportServerError(error, "management-mcp");
    return Response.json(
      { error: "Could not process this request." },
      { status: 500 }
    );
  }
};
