import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  getMcpAccount,
  MCP_ACCOUNT_SCOPE,
  MCP_OFFLINE_SCOPE,
  MCP_ACCESS_TOKEN_PREFIX,
  mcpResourceMetadataUrl,
  mcpResourceUrl,
} from "@quieter/auth/mcp";
import { MAX_SEND_PAYLOAD_BYTES } from "@quieter/mail/send";
import { consumeRateLimit } from "@quieter/orpc/abuse-protection";
import { z } from "zod";

import { registerAccountTools } from "./mcp/account.server";
import { mcpInstructions } from "./mcp/guide";
import { withApiRateLimitHeaders } from "./rate-limit-headers.server";
import { reportServerError } from "./server-error-reporting";
import {
  handleTransactionalMailMcpRequest,
  isReportableMcpError,
  registerTransactionalMailTools,
  withCors,
} from "./transactional-mail-mcp.server";

const accountSchema = z.object({
  clientId: z.string(),
  email: z.string(),
  id: z.string(),
  name: z.string(),
});

const createAccountMcpHandler = (
  scheduleBackgroundTask?: (task: Promise<unknown>) => void
) =>
  createMcpHandler(
    ({ authInfo, requestInfo }) => {
      const account = accountSchema.parse(authInfo?.extra);
      if (!requestInfo) {
        throw new Error("Missing MCP request context.");
      }
      const principal = JSON.stringify([account.id, account.clientId]);
      const server = new McpServer(
        { name: "quieter", title: "Quieter", version: "2.0.0" },
        { instructions: mcpInstructions }
      );
      registerAccountTools(server, {
        account,
        principal,
        request: requestInfo,
        scheduleBackgroundTask,
        webOrigin: new URL(mcpResourceUrl()).origin,
      });
      registerTransactionalMailTools(server, { principal, userId: account.id });
      return server;
    },
    {
      maxRequestBodySize: MAX_SEND_PAYLOAD_BYTES,
      onerror: (error) => {
        if (isReportableMcpError(error)) {
          reportServerError(error, "quieter-mcp");
        }
      },
    }
  );

export const handleQuieterMcpRequest = async (
  request: Request,
  scheduleBackgroundTask?: (task: Promise<unknown>) => void
): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  const bearer = /^Bearer +(?<value>\S+)$/iu.exec(
    request.headers.get("authorization")?.trim() ?? ""
  )?.groups?.value;
  if (bearer !== undefined && !bearer.startsWith(MCP_ACCESS_TOKEN_PREFIX)) {
    return await handleTransactionalMailMcpRequest(request);
  }

  try {
    const account = await getMcpAccount(request);
    if (account === null) {
      return withCors(
        Response.json(
          { error: "Unauthorized" },
          {
            headers: {
              "cache-control": "no-store",
              "www-authenticate": `Bearer ${bearer === undefined ? "" : 'error="invalid_token", '}resource_metadata="${mcpResourceMetadataUrl()}", scope="${MCP_ACCOUNT_SCOPE} ${MCP_OFFLINE_SCOPE}"`,
            },
            status: 401,
          }
        )
      );
    }

    if (request.method === "POST") {
      const policy = { limit: 240, windowMs: 60_000 };
      const rate = await consumeRateLimit({
        ...policy,
        key: `mcp-account:${account.id}:${account.clientId}`,
      });
      if (!rate.allowed) {
        const retryAfter = Math.max(
          1,
          Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000)
        );
        return withCors(
          withApiRateLimitHeaders(
            Response.json(
              { error: "Too many requests. Try again shortly." },
              { headers: { "retry-after": String(retryAfter) }, status: 429 }
            ),
            policy,
            rate
          )
        );
      }
    }
    const handler = createAccountMcpHandler(scheduleBackgroundTask);
    const response = await handler.fetch(request, {
      authInfo: {
        clientId: account.clientId,
        extra: account,
        scopes: [MCP_ACCOUNT_SCOPE],
        token: "verified-mcp-account",
      },
    });
    response.headers.set("cache-control", "private, no-store");
    return withCors(response);
  } catch (error) {
    reportServerError(error, "quieter-mcp");
    return withCors(
      Response.json(
        { error: "Could not process the MCP request." },
        { status: 500 }
      )
    );
  }
};
