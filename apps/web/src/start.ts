import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import {
  hasSitePasswordConfigured,
  isSitePasswordGateEnabled,
  isValidSitePasswordToken,
  sitePasswordCookieName,
} from "~/lib/site-password.server";

const sitePasswordPaths = new Set(["/api/messages", "/api/site-password", "/api/waitlist"]);
const sitePasswordPagePath = "/site-password";
const homePagePath = "/home";
const publicPathPrefixes = ["/_build/", "/assets/"];

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
  requestMiddleware: [csrfMiddleware, sitePasswordMiddleware],
}));

const shouldGatePath = (pathname: string) => {
  if (sitePasswordPaths.has(pathname)) {
    return false;
  }

  if (pathname === sitePasswordPagePath) {
    return false;
  }

  if (pathname === homePagePath) {
    return false;
  }

  return !publicPathPrefixes.some((pathPrefix) => pathname.startsWith(pathPrefix));
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
