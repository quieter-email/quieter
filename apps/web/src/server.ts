import {
  createNativeWebDeploymentEnv,
  DEPLOYMENT_ASSET_PREFIX,
  DEPLOYMENT_BUILD_HEADER,
  DEPLOYMENT_RELOAD_HEADER,
  DEPLOYMENT_STATUS_PATH,
  DEPLOYMENT_VERSION_HEADER,
  PERSONAL_ACTION_PROTOCOL,
} from "@quieter/env/deployment";
import * as Sentry from "@sentry/cloudflare";
import handler from "@tanstack/react-start/server-entry";

import { createServerSentryOptions } from "../instrument.server";

type WebWorkerEnvironment = {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  QUIETER_WEB_RELEASE?: string;
  QUIETER_WORKER_VERSION?: { id: string };
};

const serverEntry = {
  async fetch(request: Request, runtimeEnv: WebWorkerEnvironment = {}) {
    const requestedBuild = request.headers.get(DEPLOYMENT_BUILD_HEADER);
    const requestedVersion = request.headers.get(DEPLOYMENT_VERSION_HEADER);
    const { pathname } = new URL(request.url);
    const native = runtimeEnv.QUIETER_WEB_RELEASE !== undefined;
    const releaseAsset = native && pathname.startsWith(DEPLOYMENT_ASSET_PREFIX);
    if (
      (requestedBuild !== null && requestedBuild !== __QUIETER_BUILD_ID__) ||
      (requestedVersion !== null &&
        requestedVersion !== runtimeEnv.QUIETER_WORKER_VERSION?.id) ||
      (releaseAsset &&
        !pathname.startsWith(
          `${DEPLOYMENT_ASSET_PREFIX}${__QUIETER_BUILD_ID__}/assets/`
        ))
    ) {
      return new Response("Reload the site to continue.", {
        headers: {
          [DEPLOYMENT_RELOAD_HEADER]: "1",
          "cache-control": "no-store",
        },
        status: 409,
      });
    }
    if (releaseAsset) {
      if (runtimeEnv.ASSETS === undefined) {
        return new Response(null, { status: 503 });
      }
      return await runtimeEnv.ASSETS.fetch(request);
    }
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
      const manifest = native
        ? createNativeWebDeploymentEnv(runtimeEnv, __QUIETER_BUILD_ID__)
        : {
            current: {
              buildId: __QUIETER_BUILD_ID__,
              protocol: PERSONAL_ACTION_PROTOCOL,
              slot: "a",
            },
            previous: null,
          };
      const serverTime = Date.now();
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({
              ...manifest,
              previous:
                manifest.previous !== null &&
                manifest.previous.expiresAt > serverTime
                  ? manifest.previous
                  : null,
              serverTime,
            }),
        { headers: { ...headers, "content-type": "application/json" } }
      );
    }
    return await handler.fetch(request);
  },
};

export default Sentry.withSentry(
  (runtimeEnv) => createServerSentryOptions(runtimeEnv),
  serverEntry
);
