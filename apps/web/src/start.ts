import { withRequestDatabaseClient } from "@quieter/database/client";
import { serverEnv } from "@quieter/env/server";
import { consumeRateLimit } from "@quieter/orpc/abuse-protection";
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

import { isAiCrawlerRequest, prefersMarkdown } from "#/lib/agent-access.server";
import {
  agentNotFoundMarkdown,
  buildLlmsTxt,
  buildSitemapXml,
  getAgentMarkdown,
} from "#/lib/agent-content.server";
import { openApiDocument } from "#/lib/openapi-document.server";
import { withApiRateLimitHeaders } from "#/lib/rate-limit-headers.server";
import { withSecurityHeaders } from "#/lib/security-headers.server";
import { reportServerError } from "#/lib/server-error-reporting";
import {
  hasSitePasswordConfigured,
  hasValidAuthSessionToken,
  isSitePasswordGateEnabled,
  isValidSitePasswordToken,
  sitePasswordCookieName,
} from "#/lib/site-password.server";

const sitePasswordPaths = new Set([
  "/api/auth/polar/webhooks",
  "/api/internal/gmail-credentials/rotate",
  "/api/openapi",
  "/api/v1/send",
  "/api/site-password",
  "/api/waitlist",
]);
const publicLegalPaths = new Set([
  "/about",
  "/contact",
  "/cookies",
  "/imprint",
  "/privacy",
  "/terms",
]);
const sitePasswordPagePath = "/site-password";
const homePagePath = "/home";
const publicPathPrefixes = ["/_build/", "/assets/"];
const isSentryEnabled =
  import.meta.env.SSR &&
  serverEnv.NODE_ENV !== "development" &&
  serverEnv.SENTRY_DSN !== undefined;
const fallbackRateLimitBuckets = new Map<
  string,
  { count: number; expiresAt: number }
>();

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const databaseMiddleware = createMiddleware().server(
  async ({ next }) => await withRequestDatabaseClient(next)
);

const getRateLimitPolicy = (pathname: string) => {
  if (pathname.startsWith("/api/auth")) {
    return { group: "auth", limit: 20, windowMs: 60_000 };
  }
  if (pathname === "/api/waitlist") {
    return { group: "waitlist", limit: 5, windowMs: 60 * 60_000 };
  }
  if (pathname === "/api/v1/send") {
    return { group: "send", limit: 60, windowMs: 60_000 };
  }
  if (pathname.includes("/chat")) {
    return { group: "chat", limit: 120, windowMs: 60_000 };
  }
  return { group: "default", limit: 600, windowMs: 60_000 };
};

const abuseProtectionMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const requestUrl = new URL(request.url);
    const policy = getRateLimitPolicy(requestUrl.pathname);

    // Read-only requests are not quota tracked, but API responses still
    // advertise the policy so agents can self-throttle writes.
    if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
      const downstream = await next();

      if (!requestUrl.pathname.startsWith("/api/")) {
        return downstream;
      }

      return {
        ...downstream,
        response: withApiRateLimitHeaders(downstream.response, policy, {
          remaining: policy.limit,
          resetAt: new Date(Date.now() + policy.windowMs),
        }),
      };
    }

    const clientAddress =
      [
        request.headers.get("cf-connecting-ip")?.trim(),
        request.headers.get("x-real-ip")?.trim(),
        serverEnv.NODE_ENV === "development"
          ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          : undefined,
      ].find((value) => value !== undefined && value !== "") ?? "unknown";
    const key = `${policy.group}:${clientAddress}`;
    const result = await consumeRateLimit({
      key,
      limit: policy.limit,
      windowMs: policy.windowMs,
    }).catch((error: unknown) => {
      reportServerError(error, "rate-limit");

      return consumeFallbackRateLimit({
        key,
        limit: policy.limit,
        windowMs: policy.windowMs,
      });
    });

    if (!result.allowed) {
      return new Response("Too many requests", {
        headers: {
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
            )
          ),
        },
        status: 429,
      });
    }

    const downstream = await next();

    if (requestUrl.pathname.startsWith("/api/")) {
      return {
        ...downstream,
        response: withApiRateLimitHeaders(downstream.response, policy, result),
      };
    }

    return downstream;
  }
);

const consumeFallbackRateLimit = (input: {
  key: string;
  limit: number;
  windowMs: number;
}) => {
  const now = Date.now();
  const existing = fallbackRateLimitBuckets.get(input.key);
  const bucket =
    !existing || existing.expiresAt <= now
      ? { count: 1, expiresAt: now + input.windowMs }
      : { count: existing.count + 1, expiresAt: existing.expiresAt };

  fallbackRateLimitBuckets.set(input.key, bucket);

  if (fallbackRateLimitBuckets.size > 1000) {
    for (const [key, candidate] of fallbackRateLimitBuckets) {
      if (candidate.expiresAt <= now) {
        fallbackRateLimitBuckets.delete(key);
      }
    }
  }

  return {
    allowed: bucket.count <= input.limit,
    remaining: Math.max(0, input.limit - bucket.count),
    resetAt: new Date(bucket.expiresAt),
  };
};

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next();

    return {
      ...result,
      response: withSecurityHeaders(result.response),
    };
  }
);

/**
 * Serves chunks from previous releases that the current asset manifest has
 * dropped, so tabs opened before a deploy keep loading instead of failing on
 * their next lazy import. Runs before the site password gate because
 * `/assets/` is already public.
 */
const assetArchiveMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const requestUrl = new URL(request.url);
    if (
      request.method !== "GET" ||
      !requestUrl.pathname.startsWith("/assets/")
    ) {
      return await next();
    }

    const { readArchivedAsset } = await import("#/lib/asset-archive.server");
    const archived = await readArchivedAsset(requestUrl.pathname);

    return archived ?? (await next());
  }
);

const agentDocumentPaths = new Set([
  "/",
  "/home",
  "/cookies",
  "/imprint",
  "/privacy",
  "/terms",
]);

const agentTextResponse = (
  request: Request,
  body: string,
  contentType: string,
  maxAgeSeconds: number,
  status = 200
) => {
  const headers = new Headers({
    "cache-control":
      maxAgeSeconds > 0 ? `public, max-age=${maxAgeSeconds}` : "no-store",
    "content-type": contentType,
    vary: "Accept, Accept-Encoding",
  });

  return new Response(request.method.toUpperCase() === "HEAD" ? null : body, {
    headers,
    status,
  });
};

// Public machine-readable surfaces stay reachable even while the site
// password gate hides the application itself.
const wellKnownAgentSurfaceMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
      return await next();
    }

    const normalizedPath = normalizePathname(new URL(request.url).pathname);

    switch (normalizedPath) {
      case "/llms.txt": {
        return agentTextResponse(
          request,
          buildLlmsTxt(),
          "text/plain; charset=utf-8",
          300
        );
      }
      case "/openapi.json": {
        return Response.json(openApiDocument, {
          headers: {
            "cache-control": "public, max-age=3600",
            vary: "Accept-Encoding",
          },
        });
      }
      case "/sitemap.xml": {
        return agentTextResponse(
          request,
          buildSitemapXml(),
          "application/xml; charset=utf-8",
          3600
        );
      }
      default: {
        return await next();
      }
    }
  }
);

// Document paths negotiate markdown for agents and always declare Vary so
// cached HTML variants are never served to a markdown request (or vice versa).
const markdownNegotiationMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
      return await next();
    }

    const normalizedPath = normalizePathname(new URL(request.url).pathname);

    if (!agentDocumentPaths.has(normalizedPath)) {
      return await next();
    }

    const markdown = getAgentMarkdown(normalizedPath);

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

const sitePasswordMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    if (!isSitePasswordGateEnabled() || !hasSitePasswordConfigured()) {
      return await next();
    }

    const requestUrl = new URL(request.url);
    const cookies = parseCookieHeader(request.headers.get("cookie"));
    const sitePasswordCookie = cookies[sitePasswordCookieName];
    const hasValidSitePassword = isValidSitePasswordToken(sitePasswordCookie);
    const hasValidSession = await hasValidAuthSessionToken(cookies);

    if (
      requestUrl.pathname === sitePasswordPagePath &&
      (hasValidSitePassword || hasValidSession)
    ) {
      return Response.redirect(getSafeReturnToUrl(requestUrl), 302);
    }

    if (!shouldGatePath(requestUrl.pathname)) {
      return await next();
    }

    if (hasValidSitePassword || hasValidSession) {
      return await next();
    }

    // Unauthenticated agents never see the password wall for documents. The
    // landing page is public, so the root path forwards there; other gated
    // document paths get a real 404 with machine-readable pointers instead of
    // a bare 401, and gated API paths get JSON errors matching the OpenAPI
    // ErrorResponse schema instead of plain text.
    const requestMethod = request.method.toUpperCase();
    const normalizedPath = normalizePathname(requestUrl.pathname);

    if (requestMethod === "GET" || requestMethod === "HEAD") {
      if (normalizedPath === "/") {
        return Response.redirect(getHomePageUrl(request), 302);
      }

      if (isAiCrawlerRequest(request)) {
        return new Response(agentNotFoundMarkdown, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
          },
          status: 404,
        });
      }
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      const notFound = requestMethod === "GET" || requestMethod === "HEAD";

      return Response.json(
        { error: notFound ? "Not found." : "Password required." },
        {
          headers: {
            vary: "Accept",
          },
          status: notFound ? 404 : 401,
        }
      );
    }

    if (sitePasswordCookie) {
      return redirectWithExpiredSitePasswordCookie(request);
    }

    if (shouldRedirectToHomePage(request)) {
      return Response.redirect(getHomePageUrl(request), 302);
    }

    return new Response("Password required", { status: 401 });
  }
);

export const startInstance = createStart(() => ({
  functionMiddleware: isSentryEnabled ? [sentryGlobalFunctionMiddleware] : [],
  requestMiddleware: [
    ...(isSentryEnabled ? [sentryGlobalRequestMiddleware] : []),
    securityHeadersMiddleware,
    assetArchiveMiddleware,
    wellKnownAgentSurfaceMiddleware,
    markdownNegotiationMiddleware,
    abuseProtectionMiddleware,
    sitePasswordMiddleware,
    databaseMiddleware,
    csrfMiddleware,
  ],
}));

const normalizePathname = (pathname: string) => {
  const collapsed = pathname.replaceAll(/\/{2,}/gu, "/");

  if (collapsed.length <= 1) {
    return collapsed;
  }

  return collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
};

const shouldGatePath = (pathname: string) => {
  const normalizedPath = normalizePathname(pathname);

  if (sitePasswordPaths.has(normalizedPath)) {
    return false;
  }

  // OAuth return URLs must not depend on the unlock cookie (SameSite / expiry edge cases).
  if (normalizedPath.startsWith("/api/auth/callback")) {
    return false;
  }

  if (normalizedPath === sitePasswordPagePath) {
    return false;
  }

  if (normalizedPath === homePagePath) {
    return false;
  }

  if (publicLegalPaths.has(normalizedPath)) {
    return false;
  }

  return !publicPathPrefixes.some((pathPrefix) =>
    normalizedPath.startsWith(pathPrefix)
  );
};

const parseCookieHeader = (cookieHeader: string | null) => {
  const cookies: Record<string, string> = {};

  if (cookieHeader === null || cookieHeader === "") {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();

    if (!name) {
      continue;
    }

    const value = rawValue.join("=").trim();

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
};

const redirectWithExpiredSitePasswordCookie = (request: Request) => {
  const requestUrl = new URL(request.url);
  const headers = new Headers({
    "set-cookie": `${sitePasswordCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
  });

  if (shouldRedirectToHomePage(request)) {
    const passwordUrl = new URL(sitePasswordPagePath, requestUrl);
    passwordUrl.searchParams.set(
      "returnTo",
      `${requestUrl.pathname}${requestUrl.search}`
    );
    headers.set("location", passwordUrl.toString());

    return new Response(null, { headers, status: 302 });
  }

  return new Response("Password required", { headers, status: 401 });
};

const shouldRedirectToHomePage = (request: Request) =>
  request.method === "GET" &&
  (request.headers.get("accept") ?? "").includes("text/html");

const getHomePageUrl = (request: Request) => {
  const requestUrl = new URL(request.url);
  const homePageUrl = new URL(homePagePath, requestUrl);

  return homePageUrl;
};

const getSafeReturnToUrl = (requestUrl: URL) => {
  const returnTo = requestUrl.searchParams.get("returnTo");

  if (
    returnTo === null ||
    returnTo === "" ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//")
  ) {
    return new URL("/", requestUrl);
  }

  return new URL(returnTo, requestUrl);
};
