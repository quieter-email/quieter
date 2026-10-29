import {
  crossSurfaceRedirect,
  localAppOrigin,
  productionAppOrigin,
  shouldProxyAppApi,
  surfaceHeader,
} from "@quieter/env/hosts";
import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import { createServerSentryOptions } from "../instrument.server";

const hopByHop = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const withSurface = (response: Response, surface: "app" | "site") => {
  const headers = new Headers(response.headers);
  if (!headers.has(surfaceHeader)) {
    headers.set(surfaceHeader, surface);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const proxyAppApi = async (request: Request) => {
  const incoming = new URL(request.url);
  const local =
    incoming.hostname === "localhost" ||
    incoming.hostname === "127.0.0.1" ||
    incoming.hostname === "[::1]";
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    local ? localAppOrigin : productionAppOrigin
  );
  const headers = new Headers(request.headers);
  // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot names before deleting hop-by-hop headers.
  for (const name of [...headers.keys()]) {
    if (hopByHop.has(name.toLowerCase())) {
      headers.delete(name);
    }
  }
  const method = request.method.toUpperCase();
  const init: RequestInit & { duplex?: "half" } = {
    headers,
    method: request.method,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  const proxied = await fetch(target, init);
  const responseHeaders = new Headers(proxied.headers);
  // The app session cookie is host-only. Leaving Set-Cookie on this response
  // would store it on the marketing host, where it does not authenticate.
  responseHeaders.delete("set-cookie");
  if (!responseHeaders.has(surfaceHeader)) {
    responseHeaders.set(surfaceHeader, "app");
  }
  return new Response(proxied.body, {
    headers: responseHeaders,
    status: proxied.status,
    statusText: proxied.statusText,
  });
};

const serverEntry = {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (shouldProxyAppApi(url.pathname, "site")) {
      return await proxyAppApi(request);
    }
    const redirectTo = crossSurfaceRedirect(request.url, "site");
    if (redirectTo !== null) {
      return new Response(null, {
        headers: {
          location: redirectTo,
          [surfaceHeader]: "site",
        },
        status: 308,
      });
    }
    if (url.pathname === "/assets/build-id.txt") {
      const headers = { "cache-control": "no-store" };
      if (request.method !== "GET" && request.method !== "HEAD") {
        return withSurface(
          new Response(null, {
            headers: { ...headers, allow: "GET, HEAD" },
            status: 405,
          }),
          "site"
        );
      }
      return withSurface(
        new Response(request.method === "HEAD" ? null : __QUIETER_BUILD_ID__, {
          headers: {
            ...headers,
            "content-type": "text/plain; charset=utf-8",
          },
        }),
        "site"
      );
    }
    return withSurface(await handler.fetch(request), "site");
  },
};

export default Sentry.withSentry(
  (runtimeEnv) => createServerSentryOptions(runtimeEnv),
  createServerEntry(serverEntry)
);
