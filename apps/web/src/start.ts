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

const sitePasswordPaths = new Set(["/api/messages", "/api/site-password", "/api/waitlist"]);
const publicLegalPaths = new Set(["/cookies", "/privacy", "/terms"]);
const sitePasswordPagePath = "/site-password";
const homePagePath = "/home";
const publicPathPrefixes = ["/_build/", "/assets/"];
const isSentryEnabled = process.env.NODE_ENV !== "development" && !!process.env.SENTRY_DSN;

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
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

  if (normalizedPath === "/api/c15t" || normalizedPath.startsWith("/api/c15t/")) {
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
