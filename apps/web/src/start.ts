import { createMiddleware, createStart } from "@tanstack/react-start";
import {
  hasSitePasswordConfigured,
  isSitePasswordGateEnabled,
  isValidSitePasswordToken,
  sitePasswordCookieName,
} from "~/lib/site-password.server";

const sitePasswordPaths = new Set(["/api/site-password"]);
const sitePasswordPagePath = "/site-password";
const publicPathPrefixes = ["/_build/", "/assets/"];

const sitePasswordMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (!shouldGateRequest(request)) {
    return next();
  }

  const cookies = parseCookieHeader(request.headers.get("cookie"));

  if (isValidSitePasswordToken(cookies[sitePasswordCookieName])) {
    return next();
  }

  if (shouldRedirectToPasswordPage(request)) {
    return Response.redirect(getPasswordPageUrl(request), 302);
  }

  return new Response("Password required", { status: 401 });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [sitePasswordMiddleware],
}));

const shouldGateRequest = (request: Request) => {
  if (!isSitePasswordGateEnabled() || !hasSitePasswordConfigured()) {
    return false;
  }

  const requestUrl = new URL(request.url);

  if (sitePasswordPaths.has(requestUrl.pathname)) {
    return false;
  }

  if (requestUrl.pathname === sitePasswordPagePath) {
    return false;
  }

  return !publicPathPrefixes.some((pathPrefix) => requestUrl.pathname.startsWith(pathPrefix));
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

const shouldRedirectToPasswordPage = (request: Request) =>
  request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");

const getPasswordPageUrl = (request: Request) => {
  const requestUrl = new URL(request.url);
  const passwordPageUrl = new URL(sitePasswordPagePath, requestUrl);

  passwordPageUrl.searchParams.set("returnTo", `${requestUrl.pathname}${requestUrl.search}`);

  return passwordPageUrl;
};
