import path from "node:path";

import {
  DESKTOP_AUTH_CALLBACK_PATH,
  DESKTOP_AUTH_PROTOCOL_SCHEME,
} from "@quieter/auth/desktop";

import { DESKTOP_APP_ORIGIN } from "../shared/bridge";

const AUTH_ENDPOINTS = new Set([
  "change-email",
  "delete-user",
  "get-session",
  "list-accounts",
  "revoke-other-sessions",
  "sign-out",
  "unlink-account",
  "update-user",
]);

export const resolveApiTarget = (
  input: string,
  serverURL: string
): URL | null => {
  const url = new URL(input);
  if (
    `${url.protocol}//${url.host}` !== DESKTOP_APP_ORIGIN ||
    url.username ||
    url.password
  ) {
    return null;
  }
  const pathname = decodeURIComponent(url.pathname);
  if (pathname !== url.pathname || pathname.includes("\\")) {
    return null;
  }
  if (pathname.startsWith("/api/auth/")) {
    const endpoint = pathname.slice("/api/auth/".length);
    if (
      !AUTH_ENDPOINTS.has(endpoint) &&
      !endpoint.startsWith("organization/") &&
      !endpoint.startsWith("api-key/") &&
      !endpoint.startsWith("passkey/")
    ) {
      return null;
    }
  } else if (
    pathname !== "/api/chat" &&
    pathname !== "/api/desktop/session" &&
    pathname !== "/api/orpc" &&
    !pathname.startsWith("/api/orpc/")
  ) {
    return null;
  }
  return new URL(`${url.pathname}${url.search}`, serverURL);
};

export const resolveRendererFile = (
  root: string,
  input: string
): string | null => {
  const url = new URL(input);
  if (`${url.protocol}//${url.host}` !== DESKTOP_APP_ORIGIN) {
    return null;
  }
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.includes("\\") || pathname.includes("\0")) {
    return null;
  }
  const file = path.resolve(root, `.${pathname}`);
  const relativePath = path.relative(root, file);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return file;
};

export const isTrustedRendererURL = (
  input: string,
  developmentURL?: string
): boolean => {
  try {
    const url = new URL(input);
    return (
      `${url.protocol}//${url.host}` === DESKTOP_APP_ORIGIN ||
      (developmentURL !== undefined &&
        url.origin === new URL(developmentURL).origin)
    );
  } catch {
    return false;
  }
};

export const getAuthCallbackToken = (input: string): string | null => {
  try {
    const url = new URL(input);
    if (
      url.protocol !== `${DESKTOP_AUTH_PROTOCOL_SCHEME}:` ||
      `/${url.hostname}${url.pathname}` !== DESKTOP_AUTH_CALLBACK_PATH ||
      url.username ||
      url.password ||
      url.search ||
      !url.hash.startsWith("#token=")
    ) {
      return null;
    }
    const token = url.hash.slice("#token=".length);
    return token.length > 0 && token.length <= 4096 ? token : null;
  } catch {
    return null;
  }
};

export const sanitizeAuthResponse = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuthResponse);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "token",
              "accessToken",
              "refreshToken",
              "idToken",
              "password",
              "access_token",
              "refresh_token",
              "id_token",
            ].includes(key)
        )
        .map(([key, entry]) => [key, sanitizeAuthResponse(entry)])
    );
  }
  return value;
};

export const getExternalURL = (
  input: unknown,
  serverURL?: string
): string | null => {
  if (typeof input !== "string" || input.length > 32_768) {
    return null;
  }
  try {
    if (input.startsWith("//") || /\\|%5c/iu.test(input)) {
      return null;
    }
    let url =
      input.startsWith("/") && serverURL
        ? new URL(input, serverURL)
        : new URL(input);
    if (`${url.protocol}//${url.host}` === DESKTOP_APP_ORIGIN && serverURL) {
      url = new URL(`${url.pathname}${url.search}${url.hash}`, serverURL);
    }
    if (
      !["https:", "http:", "mailto:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};
