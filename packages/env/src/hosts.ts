export const surfaceHeader = "x-quieter-surface";

export const appHostname = "app.quieter.email";
export const siteHostname = "quieter.email";

export const productionAppOrigin = "https://app.quieter.email";
export const productionSiteOrigin = "https://quieter.email";
export const localAppOrigin = "http://localhost:3000";
export const localSiteOrigin = "http://localhost:3001";

export type PublicSurface = "app" | "site";

const sitePaths = new Set([
  "/home",
  "/about",
  "/contact",
  "/cookies",
  "/imprint",
  "/privacy",
  "/terms",
  "/llms.txt",
  "/sitemap.xml",
  "/api/waitlist",
]);

const dynamicPaths = new Set(["/llms.txt", "/sitemap.xml", "/openapi.json"]);

const staticPrefixes = ["/assets/", "/_releases/", "/landing/", "/_build/"];

export const normalizePathname = (pathname: string) => {
  const collapsed = pathname.replaceAll(/\/{2,}/gu, "/");
  if (collapsed.length <= 1) {
    return collapsed || "/";
  }
  return collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
};

const isLoopback = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export const isStaticAssetPath = (pathname: string) => {
  const normalized = normalizePathname(pathname);
  if (sitePaths.has(normalized) || dynamicPaths.has(normalized)) {
    return false;
  }
  if (staticPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return /\.[a-z0-9]+$/iu.test(normalized);
};

export const pathSurface = (
  pathname: string
): PublicSurface | "asset" | "health" => {
  const normalized = normalizePathname(pathname);
  if (normalized === "/api/health") {
    return "health";
  }
  if (sitePaths.has(normalized)) {
    return "site";
  }
  if (isStaticAssetPath(normalized)) {
    return "asset";
  }
  return "app";
};

export const originForSurface = (surface: PublicSurface, dev: boolean) => {
  if (surface === "site") {
    return dev ? localSiteOrigin : productionSiteOrigin;
  }
  return dev ? localAppOrigin : productionAppOrigin;
};

export const hrefForSurface = (
  surface: PublicSurface,
  pathname: string,
  search: string,
  hash: string,
  dev: boolean
) => {
  const query = search === "" || search.startsWith("?") ? search : `?${search}`;
  const fragment = hash === "" || hash.startsWith("#") ? hash : `#${hash}`;
  return `${originForSurface(surface, dev)}${pathname}${query}${fragment}`;
};

export const crossSurfaceTarget = (
  requestUrl: string,
  current: PublicSurface,
  dev: boolean
) => {
  const url = new URL(requestUrl);
  const normalized = normalizePathname(url.pathname);
  if (current === "site" && normalized === "/") {
    return null;
  }
  const surface = pathSurface(normalized);
  if (surface === "asset" || surface === "health" || surface === current) {
    return null;
  }
  return new URL(`${normalized}${url.search}`, originForSurface(surface, dev))
    .href;
};

export const crossSurfaceRedirect = (
  requestUrl: string,
  current: PublicSurface
) => {
  const url = new URL(requestUrl);
  const local = isLoopback(url.hostname);
  const onProduction =
    current === "app"
      ? url.hostname === appHostname
      : url.hostname === siteHostname || url.hostname === `www.${siteHostname}`;
  if (!local && !onProduction) {
    return null;
  }
  return crossSurfaceTarget(requestUrl, current, local);
};

export const shouldProxyAppApi = (pathname: string, current: PublicSurface) => {
  const normalized = normalizePathname(pathname);
  return (
    current === "site" &&
    normalized.startsWith("/api/") &&
    pathSurface(normalized) === "app"
  );
};
