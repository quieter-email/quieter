import { consumeRateLimit } from "@quieter/orpc/abuse-protection";
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from "@sentry/tanstackstart-react";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import {
  hasSitePasswordConfigured,
  isSitePasswordGateEnabled,
  isValidSitePasswordToken,
  sitePasswordCookieName,
} from "~/lib/site-password.server";

const sitePasswordPaths = new Set([
  "/api/internal/gmail-credentials/rotate",
  "/api/messages",
  "/api/site-password",
  "/api/waitlist",
]);
const publicLegalPaths = new Set(["/cookies", "/privacy", "/terms"]);
const sitePasswordPagePath = "/site-password";
const homePagePath = "/home";
const publicPathPrefixes = ["/_build/", "/assets/"];
const isSentryEnabled = process.env.NODE_ENV !== "development" && !!process.env.SENTRY_DSN;

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const getRateLimitPolicy = (pathname: string) => {
  if (pathname.startsWith("/api/auth")) return { limit: 20, windowMs: 60_000 };
  if (pathname === "/api/waitlist") return { limit: 5, windowMs: 60 * 60_000 };
  if (pathname === "/api/messages") return { limit: 60, windowMs: 60_000 };
  if (pathname.includes("/chat")) return { limit: 30, windowMs: 60_000 };
  return { limit: 120, windowMs: 60_000 };
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
  const result = await consumeRateLimit({
    key: `${requestUrl.pathname}:${clientAddress}`,
    ...policy,
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

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  result.response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self' https: wss:",
      "font-src 'self' data: https:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob: https:",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https:",
    ].join("; "),
  );
  result.response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  result.response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.response.headers.set("X-Content-Type-Options", "nosniff");
  result.response.headers.set("X-Frame-Options", "DENY");
  return result;
});

const sitePasswordMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (!isSitePasswordGateEnabled() || !hasSitePasswordConfigured()) {
    return next();
  }

  const requestUrl = new URL(request.url);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const hasValidSitePassword = isValidSitePasswordToken(cookies[sitePasswordCookieName]);

  if (requestUrl.pathname === sitePasswordPagePath && hasValidSitePassword) {
    return Response.redirect(getSafeReturnToUrl(requestUrl), 302);
  }

  if (!shouldGatePath(requestUrl.pathname)) {
    return next();
  }

  if (hasValidSitePassword) {
    return next();
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

    cookies[name] = decodeURIComponent(rawValue.join("=").trim());
  }

  return cookies;
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
