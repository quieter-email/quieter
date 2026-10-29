import { withRequestDatabaseClient } from "@quieter/database/client";
import { checkDeploymentDatabase } from "@quieter/orpc/deployment-health";
import { createMiddleware, createStart } from "@tanstack/react-start";

import {
  buildLlmsTxt,
  buildSitemapXml,
  getAgentMarkdown,
} from "#/lib/agent-content.server";
import { withSecurityHeaders } from "#/lib/security-headers.server";

const prefersMarkdown = (request: Request) =>
  (request.headers.get("accept") ?? "").toLowerCase().includes("text/markdown");

const normalizePathname = (pathname: string) => {
  const collapsed = pathname.replaceAll(/\/{2,}/gu, "/");
  if (collapsed.length <= 1) {
    return collapsed;
  }
  return collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
};

const agentTextResponse = (
  request: Request,
  body: string,
  contentType: string,
  maxAgeSeconds: number
) =>
  new Response(request.method.toUpperCase() === "HEAD" ? null : body, {
    headers: {
      "cache-control": `public, max-age=${maxAgeSeconds}`,
      "content-type": contentType,
      vary: "Accept, Accept-Encoding",
    },
  });

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next();
    return {
      ...result,
      response: withSecurityHeaders(result.response),
    };
  }
);

const wellKnownMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
      return await next();
    }
    const pathname = normalizePathname(new URL(request.url).pathname);
    if (pathname === "/llms.txt") {
      return agentTextResponse(
        request,
        buildLlmsTxt(),
        "text/plain; charset=utf-8",
        300
      );
    }
    if (pathname === "/sitemap.xml") {
      return agentTextResponse(
        request,
        buildSitemapXml(),
        "application/xml; charset=utf-8",
        3600
      );
    }
    return await next();
  }
);

const markdownMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
      return await next();
    }
    const pathname = normalizePathname(new URL(request.url).pathname);
    const markdown = getAgentMarkdown(pathname);
    if (prefersMarkdown(request) && markdown !== undefined) {
      return agentTextResponse(
        request,
        markdown,
        "text/markdown; charset=utf-8",
        300
      );
    }
    const result = await next();
    const headers = new Headers(result.response.headers);
    headers.append("vary", "Accept");
    return {
      ...result,
      response: new Response(result.response.body, {
        headers,
        status: result.response.status,
        statusText: result.response.statusText,
      }),
    };
  }
);

let databaseHealthyUntil = 0;
let databaseCheckRunning = false;

const healthMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    if (new URL(request.url).pathname !== "/api/health") {
      return await next();
    }
    const headers = { "cache-control": "no-store" };
    if (request.method !== "GET") {
      return new Response(null, {
        headers: { ...headers, allow: "GET" },
        status: 405,
      });
    }
    if (databaseHealthyUntil <= Date.now()) {
      if (databaseCheckRunning) {
        return new Response(null, { headers, status: 503 });
      }
      databaseCheckRunning = true;
      try {
        await checkDeploymentDatabase();
        databaseHealthyUntil = Date.now() + 30_000;
      } catch (error) {
        // oxlint-disable-next-line no-console -- Local and worker logs stay available when reporting is not configured.
        console.error("[site-health]", error);
        return new Response(null, { headers, status: 503 });
      } finally {
        databaseCheckRunning = false;
      }
    }
    return Response.json(
      { buildId: __QUIETER_BUILD_ID__, healthy: true },
      { headers }
    );
  }
);

const databaseMiddleware = createMiddleware().server(
  async ({ next }) => await withRequestDatabaseClient(async () => await next())
);

export const startInstance = createStart(() => ({
  requestMiddleware: [
    securityHeadersMiddleware,
    wellKnownMiddleware,
    markdownMiddleware,
    databaseMiddleware,
    healthMiddleware,
  ],
}));
