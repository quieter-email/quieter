import {
  createWebDeploymentEnv,
  DEPLOYMENT_ASSET_PREFIX,
  DEPLOYMENT_BUILD_HEADER,
  DEPLOYMENT_RELOAD_HEADER,
  DEPLOYMENT_STATUS_PATH,
  deploymentStatusSchema,
} from "@quieter/env/deployment";

type WebRouterEnv = {
  QUIETER_WEB_DEPLOYMENT: string;
  WebReleaseA: Fetcher;
  WebReleaseB: Fetcher;
};

export default {
  async fetch(request, env) {
    const manifest = createWebDeploymentEnv({
      QUIETER_WEB_DEPLOYMENT: env.QUIETER_WEB_DEPLOYMENT,
    });
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === DEPLOYMENT_STATUS_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          headers: { allow: "GET, HEAD", "cache-control": "no-store" },
          status: 405,
        });
      }
      let { previous } = manifest;
      if (previous !== null && previous.expiresAt > now) {
        try {
          const worker =
            previous.slot === "a" ? env.WebReleaseA : env.WebReleaseB;
          const response = await worker.fetch(
            new URL(DEPLOYMENT_STATUS_PATH, url.origin).href,
            {
              headers: { [DEPLOYMENT_BUILD_HEADER]: previous.buildId },
              redirect: "manual",
              signal: AbortSignal.timeout(3000),
            }
          );
          if (
            response.status === 409 &&
            response.headers.get(DEPLOYMENT_RELOAD_HEADER) === "1"
          ) {
            previous = null;
          } else {
            if (
              !response.ok ||
              response.headers
                .get("content-type")
                ?.includes("application/json") !== true
            ) {
              throw new Error(
                "The retained web release did not return deployment status."
              );
            }
            const status = deploymentStatusSchema.parse(await response.json());
            if (status.current.buildId !== previous.buildId) {
              throw new Error(
                "The retained web release returned a different build."
              );
            }
          }
        } catch {
          return new Response(null, {
            headers: { "cache-control": "no-store" },
            status: 503,
          });
        }
      }
      const serverTime = Date.now();
      if (previous !== null && previous.expiresAt <= serverTime) {
        previous = null;
      }
      return new Response(
        request.method === "HEAD"
          ? null
          : JSON.stringify({ ...manifest, previous, serverTime }),
        {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/json",
          },
        }
      );
    }
    if (url.pathname === "/assets/build-id.txt") {
      return new Response(
        request.method === "HEAD" ? null : manifest.current.buildId,
        {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        }
      );
    }

    let requestedBuild: string | null = null;
    if (url.pathname.startsWith(DEPLOYMENT_ASSET_PREFIX)) {
      const suffix = url.pathname.slice(DEPLOYMENT_ASSET_PREFIX.length);
      const slash = suffix.indexOf("/");
      requestedBuild =
        slash !== -1 && suffix.slice(slash).startsWith("/assets/")
          ? suffix.slice(0, slash)
          : "";
    } else if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/_serverFn/")
    ) {
      requestedBuild = request.headers.get(DEPLOYMENT_BUILD_HEADER);
    }
    let release = null;
    if (
      requestedBuild === null ||
      requestedBuild === manifest.current.buildId
    ) {
      release = manifest.current;
    } else if (
      manifest.previous?.buildId === requestedBuild &&
      manifest.previous.expiresAt > now
    ) {
      release = manifest.previous;
    }
    if (release === null) {
      return new Response("Reload the site to continue.", {
        headers: {
          "cache-control": "no-store",
          [DEPLOYMENT_RELOAD_HEADER]: "1",
        },
        status: 409,
      });
    }

    const headers = new Headers(request.headers);
    // Snapshot keys because deleting a live iterator's current key can skip its successor.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const name of [...headers.keys()]) {
      if (
        name.startsWith("cloudflare-workers-version-") ||
        name.startsWith("cf-workers-version-")
      ) {
        headers.delete(name);
      }
    }
    headers.set(DEPLOYMENT_BUILD_HEADER, release.buildId);
    const worker = release.slot === "a" ? env.WebReleaseA : env.WebReleaseB;
    return await worker.fetch(url.href, new Request(request, { headers }));
  },
} satisfies ExportedHandler<WebRouterEnv>;
