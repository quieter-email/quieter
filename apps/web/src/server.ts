import {
  DEPLOYMENT_BUILD_HEADER,
  DEPLOYMENT_RELOAD_HEADER,
  DEPLOYMENT_STATUS_PATH,
} from "@quieter/env/deployment";
import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import { createServerSentryOptions } from "../instrument.server";

const serverEntry = {
  async fetch(request: Request) {
    const requestedBuild = request.headers.get(DEPLOYMENT_BUILD_HEADER);
    if (requestedBuild !== null && requestedBuild !== __QUIETER_BUILD_ID__) {
      return new Response("Reload the site to continue.", {
        headers: {
          "cache-control": "no-store",
          [DEPLOYMENT_RELOAD_HEADER]: "1",
        },
        status: 409,
      });
    }
    const { pathname } = new URL(request.url);
    if (
      pathname === DEPLOYMENT_STATUS_PATH ||
      pathname === "/assets/build-id.txt"
    ) {
      const headers = { "cache-control": "no-store" };
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          headers: { ...headers, allow: "GET, HEAD" },
          status: 405,
        });
      }
      if (pathname === "/assets/build-id.txt") {
        return new Response(
          request.method === "HEAD" ? null : __QUIETER_BUILD_ID__,
          {
            headers: {
              ...headers,
              "content-type": "text/plain; charset=utf-8",
            },
          }
        );
      }
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({
              current: { buildId: __QUIETER_BUILD_ID__, slot: "a" },
              previous: null,
              serverTime: Date.now(),
            }),
        { headers: { ...headers, "content-type": "application/json" } }
      );
    }
    return await handler.fetch(request);
  },
};

export default Sentry.withSentry(
  (runtimeEnv) => createServerSentryOptions(runtimeEnv),
  createServerEntry(serverEntry)
);
