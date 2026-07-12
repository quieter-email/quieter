import { withRequestDatabaseClient } from "@quieter/database/client";
import { consumeRateLimit } from "@quieter/orpc/abuse-protection";
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { withSecurityHeaders } from "~/lib/security-headers.server";
import {
  hasSitePasswordConfigured,
  isSitePasswordGateEnabled,
  isValidSitePasswordToken,
  sitePasswordCookieName,
} from "~/lib/site-password.server";

const sitePasswordPaths = new Set([
  "/api/auth/polar/webhooks",
  "/api/internal/gmail-credentials/rotate",
  "/api/v1/send",
  "/api/site-password",
  "/api/waitlist",
]);
const publicLegalPaths = new Set(["/cookies", "/imprint", "/privacy", "/terms"]);
const sitePasswordPagePath = "/site-password";
const homePagePath = "/home";
const publicPathPrefixes = ["/_build/", "/assets/"];
const isSentryEnabled = process.env.NODE_ENV !== "development" && !!process.env.SENTRY_DSN;
const fallbackRateLimitBuckets = new Map<string, { count: number; expiresAt: number }>();

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const databaseMiddleware = createMiddleware().server(async ({ next }) =>
  withRequestDatabaseClient(next),
);

const getRateLimitPolicy = (pathname: string) => {
  if (pathname.startsWith("/api/auth")) return { group: "auth", limit: 20, windowMs: 60_000 };
  if (pathname === "/api/waitlist") {
    return { group: "waitlist", limit: 5, windowMs: 60 * 60_000 };
  }
  if (pathname === "/api/v1/send") {
    return { group: "send", limit: 60, windowMs: 60_000 };
  }
  if (pathname.includes("/chat")) return { group: "chat", limit: 30, windowMs: 60_000 };
  return { group: "default", limit: 120, windowMs: 60_000 };
};

const abuseProtectionMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    return next();
  }

  const requestUrl = new URL(request.url);
  const clientAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const policy = getRateLimitPolicy(requestUrl.pathname);
  const key = `${policy.group}:${clientAddress}`;
  const result = await consumeRateLimit({
    key,
    limit: policy.limit,
    windowMs: policy.windowMs,
  }).catch((error: unknown) => {
    console.error("Persistent rate limiting unavailable; using the local fallback", error);

    return consumeFallbackRateLimit({ key, limit: policy.limit, windowMs: policy.windowMs });
  });

  if (!result.allowed) {
    return new Response("Too many requests", {
      headers: {
        "Retry-After": String(
          Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)),
        ),
      },
      status: 429,
    });
  }

  return next();
});

const consumeFallbackRateLimit = (input: { key: string; limit: number; windowMs: number }) => {
  const now = Date.now();
  const existing = fallbackRateLimitBuckets.get(input.key);
  const bucket =
    !existing || existing.expiresAt <= now
      ? { count: 1, expiresAt: now + input.windowMs }
      : { count: existing.count + 1, expiresAt: existing.expiresAt };

  fallbackRateLimitBuckets.set(input.key, bucket);

  if (fallbackRateLimitBuckets.size > 1_000) {
    for (const [key, candidate] of fallbackRateLimitBuckets) {
      if (candidate.expiresAt <= now) fallbackRateLimitBuckets.delete(key);
    }
  }

  return {
    allowed: bucket.count <= input.limit,
    remaining: Math.max(0, input.limit - bucket.count),
    resetAt: new Date(bucket.expiresAt),
  };
};

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();

  return {
    ...result,
    response: withSecurityHeaders(result.response),
  };
});

const sitePasswordMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (!isSitePasswordGateEnabled() || !hasSitePasswordConfigured()) {
    return next();
  }

  const requestUrl = new URL(request.url);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const sitePasswordCookie = cookies[sitePasswordCookieName];
  const hasValidSitePassword = isValidSitePasswordToken(sitePasswordCookie);

  if (requestUrl.pathname === sitePasswordPagePath && hasValidSitePassword) {
    return Response.redirect(getSafeReturnToUrl(requestUrl), 302);
  }

  if (!shouldGatePath(requestUrl.pathname)) {
    return next();
  }

  if (hasValidSitePassword) {
    return next();
  }

  if (sitePasswordCookie) {
    return redirectWithExpiredSitePasswordCookie(request);
  }

  if (shouldRedirectToHomePage(request)) {
    return Response.redirect(getHomePageUrl(request), 302);
  }

  return new Response("Password required", { status: 401 });
});

export const startInstance = createStart(() => ({
  functionMiddleware: isSentryEnabled ? [sentryGlobalFunctionMiddleware] : [],
  requestMiddleware: [
    ...(isSentryEnabled ? [sentryGlobalRequestMiddleware] : []),
    securityHeadersMiddleware,
    databaseMiddleware,
    abuseProtectionMiddleware,
    csrfMiddleware,
    sitePasswordMiddleware,
  ],
}));

const normalizePathname = (pathname: string) => {
  const collapsed = pathname.replace(/\/{2,}/g, "/");

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

  if (normalizedPath === sitePasswordPagePath) {
    return false;
  }

  if (normalizedPath === homePagePath) {
    return false;
  }

  if (publicLegalPaths.has(normalizedPath)) {
    return false;
  }

  return !publicPathPrefixes.some((pathPrefix) => normalizedPath.startsWith(pathPrefix));
};

const parseCookieHeader = (cookieHeader: string | null) => {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
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
    passwordUrl.searchParams.set("returnTo", `${requestUrl.pathname}${requestUrl.search}`);
    headers.set("location", passwordUrl.toString());

    return new Response(null, { headers, status: 302 });
  }

  return new Response("Password required", { headers, status: 401 });
};

const shouldRedirectToHomePage = (request: Request) =>
  request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");

const getHomePageUrl = (request: Request) => {
  const requestUrl = new URL(request.url);
  const homePageUrl = new URL(homePagePath, requestUrl);

  return homePageUrl;
};

const getSafeReturnToUrl = (requestUrl: URL) => {
  const returnTo = requestUrl.searchParams.get("returnTo");

  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return new URL("/", requestUrl);
  }

  return new URL(returnTo, requestUrl);
};
