import {
  createMcpHandler,
  McpServer,
  ProtocolError,
} from "@modelcontextprotocol/server";
import type { McpRequestContext } from "@modelcontextprotocol/server";
import {
  API_VERSION_HEADER,
  rejectApiCompatibility,
  stampApiCompatibility,
} from "@quieter/mail/public-api";
import { MAX_SEND_PAYLOAD_BYTES } from "@quieter/mail/send";
import { z } from "zod";

import { getOrganizationApiKeyOrganizationId } from "./organization-api-auth.server";
import { reportServerError } from "./server-error-reporting";
import type { TransactionalMailAccess } from "./transactional-mcp-access.server";
import { registerTransactionalMailDeliveryTools } from "./transactional-mcp-delivery.server";
import { registerTransactionalMailSendTool } from "./transactional-mcp-send.server";
import type { SendTransactionalMail } from "./transactional-mcp-send.server";

const serverInfo = {
  name: "quieter-transactional-mail",
  title: "quieter Transactional Mail",
  version: "1.0.0",
};

const serverInstructions =
  "Use send_email to send transactional mail from this team's verified domains. Use transactional_get_delivery with the returned message ID to check delivery. Use transactional_list_suppressions to see which addresses are blocked.";

export const registerTransactionalMailTools = (
  server: McpServer,
  access: TransactionalMailAccess,
  sendTransactionalMail?: SendTransactionalMail
) => {
  registerTransactionalMailSendTool(server, access, sendTransactionalMail);
  registerTransactionalMailDeliveryTools(server, access);
};

export const buildTransactionalMailMcpServer = (input: {
  organizationId: string;
  sendTransactionalMail?: SendTransactionalMail;
}): McpServer => {
  const server = new McpServer(serverInfo, {
    instructions: serverInstructions,
  });
  registerTransactionalMailTools(
    server,
    { organizationId: input.organizationId },
    input.sendTransactionalMail
  );
  return server;
};

const getOrganizationId = (context: McpRequestContext) => {
  const organizationId = context.authInfo?.extra?.organizationId;
  if (typeof organizationId !== "string" || organizationId === "") {
    throw new Error(
      "The transactional mail MCP request is missing its organization context."
    );
  }
  return organizationId;
};

const expectedMcpClientErrorPrefixes = [
  "Bad Request",
  "Conflict",
  "Failed to write to the response stream",
  "Invalid event ID format",
  "Invalid Request",
  "Method not allowed",
  "Not Acceptable",
  "Parse error",
  "Received a response for an unknown request id",
  "Session not found",
  "Unsupported Media Type",
  "Unsupported protocol version",
];

export const isReportableMcpError = (error: Error) =>
  !(error instanceof ProtocolError) &&
  !(error instanceof SyntaxError) &&
  !(error instanceof z.ZodError) &&
  !expectedMcpClientErrorPrefixes.some((prefix) =>
    error.message.startsWith(prefix)
  );

const transactionalMailMcpHandler = createMcpHandler(
  (context) =>
    buildTransactionalMailMcpServer({
      organizationId: getOrganizationId(context),
    }),
  {
    maxRequestBodySize: MAX_SEND_PAYLOAD_BYTES,
    onerror: (error) => {
      if (isReportableMcpError(error)) {
        reportServerError(error, "transactional-mail-mcp");
      }
    },
  }
);

const corsHeaders = {
  "access-control-allow-headers": `authorization, content-type, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, ${API_VERSION_HEADER}`,
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": `mcp-protocol-version, mcp-session-id, www-authenticate, ${API_VERSION_HEADER}`,
  "access-control-max-age": "86400",
};

export const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const withCompatibleCors = (response: Response) =>
  withCors(stampApiCompatibility(response));

export const handleTransactionalMailMcpRequest = async (
  request: Request
): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }

  const rejected = rejectApiCompatibility(request.headers);
  if (rejected !== null) {
    return withCors(rejected);
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_SEND_PAYLOAD_BYTES
  ) {
    return withCompatibleCors(
      Response.json({ error: "Request body is too large." }, { status: 413 })
    );
  }

  const organizationId = await getOrganizationApiKeyOrganizationId(request);
  if (organizationId === null) {
    return withCompatibleCors(
      Response.json(
        { error: "Unauthorized" },
        {
          headers: {
            "www-authenticate": 'Bearer realm="quieter-transactional-mail"',
          },
          status: 401,
        }
      )
    );
  }

  try {
    const response = await transactionalMailMcpHandler.fetch(request, {
      authInfo: {
        clientId: organizationId,
        extra: { organizationId },
        scopes: [],
        token: "organization-api-key",
      },
    });
    return withCompatibleCors(response);
  } catch (error) {
    reportServerError(error, "transactional-mail-mcp");
    return withCompatibleCors(
      Response.json(
        { error: "Could not process the MCP request." },
        { status: 500 }
      )
    );
  }
};
