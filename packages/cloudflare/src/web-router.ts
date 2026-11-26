import {
  createWebDeploymentEnv,
  DEPLOYMENT_ASSET_PREFIX,
  DEPLOYMENT_BOOTSTRAP_HEADER,
  DEPLOYMENT_BUILD_HEADER,
  DEPLOYMENT_PROBE_HEADER,
  DEPLOYMENT_RELOAD_HEADER,
  DEPLOYMENT_STATUS_PATH,
  DEPLOYMENT_VERSION_HEADER,
  deploymentStatusSchema,
  webReleaseProbeSchema,
} from "@quieter/env/deployment";
import type { DeploymentManifest } from "@quieter/env/deployment";

import { timingSafeEqual } from "./crypto-utils";

type WebRouterEnv = {
  QUIETER_WEB_DEPLOYMENT?: string;
  WebApp?: Fetcher;
  WebAppScriptName?: string;
  WebReleaseA?: Fetcher;
  WebReleaseB?: Fetcher;
  WebReleaseProbeToken?: string;
};

const textEncoder = new TextEncoder();
const noStore = { "cache-control": "no-store" };
const manifestCache = new WeakMap<
  Fetcher,
  { expiresAt: number; manifest: DeploymentManifest }
>();

const fetchNativeVersion = async (
  request: Request,
  env: WebRouterEnv,
  versionId: string,
  headers: Headers
) => {
  if (
    env.WebApp === undefined ||
    env.WebAppScriptName === undefined ||
    !/^[\w-]+$/u.test(env.WebAppScriptName)
  ) {
    return new Response(null, { headers: noStore, status: 503 });
  }
  headers.set(
    "Cloudflare-Workers-Version-Overrides",
    `${env.WebAppScriptName}="${versionId}"`
  );
  headers.set(DEPLOYMENT_VERSION_HEADER, versionId);
  return await env.WebApp.fetch(request.url, new Request(request, { headers }));
};

const readManifest = async (
  url: URL,
  env: WebRouterEnv
): Promise<DeploymentManifest> => {
  if (env.WebApp !== undefined) {
    const cached = manifestCache.get(env.WebApp);
    if (
      url.pathname !== DEPLOYMENT_STATUS_PATH &&
      cached &&
      cached.expiresAt > Date.now()
    ) {
      return cached.manifest;
    }
    const response = await env.WebApp.fetch(
      new URL(DEPLOYMENT_STATUS_PATH, url).href,
      { redirect: "manual", signal: AbortSignal.timeout(3000) }
    );
    if (response.ok) {
      const manifest = deploymentStatusSchema.parse(await response.json());
      if (manifest.current.versionId === undefined) {
        throw new Error("The app did not identify its active Worker version.");
      }
      manifestCache.set(env.WebApp, { expiresAt: Date.now() + 1000, manifest });
      return manifest;
    }
    manifestCache.delete(env.WebApp);
    if (
      response.status !== 404 ||
      response.headers.get(DEPLOYMENT_BOOTSTRAP_HEADER) !== "1"
    ) {
      throw new Error("Cannot read the active web release.");
    }
  }
  return createWebDeploymentEnv(env);
};

const forwardRelease = async (
  request: Request,
  env: WebRouterEnv,
  release: DeploymentManifest["current"]
) => {
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
  if (release.versionId !== undefined) {
    return await fetchNativeVersion(request, env, release.versionId, headers);
  }
  const legacy = release.slot === "a" ? env.WebReleaseA : env.WebReleaseB;
  if (legacy === undefined) {
    return new Response(null, { headers: noStore, status: 503 });
  }
  return await legacy.fetch(request.url, new Request(request, { headers }));
};

const probeRelease = async (request: Request, url: URL, env: WebRouterEnv) => {
  const token = request.headers.get(DEPLOYMENT_PROBE_HEADER);
  const { WebReleaseProbeToken: expectedToken } = env;
  const probe = webReleaseProbeSchema.safeParse({
    buildId: request.headers.get(DEPLOYMENT_BUILD_HEADER),
    versionId: request.headers.get(DEPLOYMENT_VERSION_HEADER),
  });
  if (
    !token ||
    !expectedToken ||
    !probe.success ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return new Response(null, { headers: noStore, status: 404 });
  }
  const { buildId, versionId } = probe.data;
  const probeAsset =
    url.pathname.startsWith(`${DEPLOYMENT_ASSET_PREFIX}${buildId}/assets/`) &&
    /\.(?:js|css)$/u.test(url.pathname);
  if (
    url.pathname !== "/api/health" &&
    url.pathname !== "/assets/build-id.txt" &&
    url.pathname !== "/about" &&
    !probeAsset
  ) {
    return new Response(null, { headers: noStore, status: 404 });
  }
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(token)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expectedToken)),
  ]);
  if (!timingSafeEqual(actual, expected)) {
    return new Response(null, { headers: noStore, status: 404 });
  }
  const headers = new Headers({ [DEPLOYMENT_BUILD_HEADER]: buildId });
  const accept = request.headers.get("accept");
  if (accept !== null) {
    headers.set("accept", accept);
  }
  let response: Response;
  if (versionId === "legacy") {
    const { current } = createWebDeploymentEnv(env);
    if (current.buildId !== buildId) {
      return new Response(null, { headers: noStore, status: 404 });
    }
    response = await forwardRelease(
      new Request(request, { headers }),
      env,
      current
    );
  } else {
    response = await fetchNativeVersion(request, env, versionId, headers);
  }
  const result = new Response(response.body, response);
  result.headers.set("cache-control", "no-store");
  return result;
};

const deploymentStatus = async (
  request: Request,
  env: WebRouterEnv,
  manifest: DeploymentManifest
) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      headers: { ...noStore, allow: "GET, HEAD" },
      status: 405,
    });
  }
  let { previous } = manifest;
  if (previous !== null && previous.expiresAt > Date.now()) {
    const response = await forwardRelease(
      new Request(request.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      }),
      env,
      previous
    );
    if (
      response.status === 409 &&
      response.headers.get(DEPLOYMENT_RELOAD_HEADER) === "1"
    ) {
      previous = null;
    } else {
      if (
        !response.ok ||
        response.headers.get("content-type")?.includes("application/json") !==
          true
      ) {
        throw new Error(
          "The retained web release did not return deployment status."
        );
      }
      const status = deploymentStatusSchema.parse(await response.json());
      if (
        status.current.buildId !== previous.buildId ||
        status.current.versionId !== previous.versionId
      ) {
        throw new Error("The retained web release returned a different build.");
      }
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
    { headers: { ...noStore, "content-type": "application/json" } }
  );
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      request.headers.has(DEPLOYMENT_PROBE_HEADER) ||
      request.headers.has(DEPLOYMENT_VERSION_HEADER)
    ) {
      return await probeRelease(request, url, env);
    }
    let manifest: DeploymentManifest;
    try {
      manifest = await readManifest(url, env);
      if (url.pathname === DEPLOYMENT_STATUS_PATH) {
        return await deploymentStatus(request, env, manifest);
      }
    } catch {
      return new Response(null, { headers: noStore, status: 503 });
    }
    if (url.pathname === "/assets/build-id.txt") {
      return new Response(
        request.method === "HEAD" ? null : manifest.current.buildId,
        {
          headers: { ...noStore, "content-type": "text/plain; charset=utf-8" },
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
    let usesCurrentPolicy = false;
    try {
      usesCurrentPolicy = /^\/+api\/+waitlist\/*$/iu.test(
        decodeURI(url.pathname)
      );
    } catch {
      usesCurrentPolicy = false;
    }
    if (
      usesCurrentPolicy ||
      requestedBuild === null ||
      requestedBuild === manifest.current.buildId
    ) {
      release = manifest.current;
    } else if (
      manifest.previous?.buildId === requestedBuild &&
      manifest.previous.expiresAt > Date.now()
    ) {
      release = manifest.previous;
    }
    if (release === null) {
      return new Response("Reload the site to continue.", {
        headers: { ...noStore, [DEPLOYMENT_RELOAD_HEADER]: "1" },
        status: 409,
      });
    }
    return await forwardRelease(request, env, release);
  },
} satisfies ExportedHandler<WebRouterEnv>;
