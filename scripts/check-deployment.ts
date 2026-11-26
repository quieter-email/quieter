/* oxlint-disable eslint/no-await-in-loop -- Keep retries ordered and bound concurrent production probes. */
import { setTimeout } from "node:timers/promises";

export const checkDeployment = async (
  origin: string,
  buildId: string,
  mailUpdatesUrl?: string,
  probeHeaders?: ConstructorParameters<typeof Headers>[0]
) => {
  const base = new URL(origin);
  const options = {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  } as const;
  const probeOptions = { ...options, headers: probeHeaders };
  const health = await fetch(new URL("/api/health", base), probeOptions);
  const status: unknown = await health.json();
  if (
    !health.ok ||
    typeof status !== "object" ||
    status === null ||
    !("buildId" in status) ||
    status.buildId !== buildId ||
    !("healthy" in status) ||
    status.healthy !== true
  ) {
    throw new Error("The expected server release is not healthy.");
  }
  const marker = await fetch(
    new URL("/assets/build-id.txt", base),
    probeOptions
  );
  const markerText = await marker.text();
  if (!marker.ok || markerText.trim() !== buildId) {
    throw new Error("Server and static assets belong to different releases.");
  }
  const htmlHeaders = new Headers(probeHeaders);
  htmlHeaders.set("accept", "text/html");
  const page = await fetch(new URL("/about", base), {
    ...options,
    headers: htmlHeaders,
  });
  const html = await page.text();
  if (
    !page.ok ||
    page.headers.get("content-type")?.includes("text/html") !== true ||
    !/<h1[\s>]/iu.test(html)
  ) {
    throw new Error("The public page did not render server-side.");
  }
  const assets = new Set<string>();
  for (const match of html.matchAll(
    /(?:src|href)=["'](?<asset>[^"']+)["']/gu
  )) {
    const url = new URL(match.groups?.asset ?? "", base);
    if (url.origin === base.origin && /\.(?:js|css)$/u.test(url.pathname)) {
      assets.add(url.href);
    }
  }
  if (
    ![...assets].some((url) => url.endsWith(".js")) ||
    ![...assets].some((url) => url.endsWith(".css"))
  ) {
    throw new Error("SSR did not reference both JavaScript and CSS assets.");
  }
  for (const asset of assets) {
    const response = await fetch(asset, {
      ...probeOptions,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !response.ok ||
      !(asset.endsWith(".css")
        ? contentType.includes("text/css")
        : /javascript/u.test(contentType)) ||
      body.byteLength === 0
    ) {
      throw new Error(
        `A deployed asset is unavailable: ${new URL(asset).pathname}`
      );
    }
  }
  if (mailUpdatesUrl) {
    const response = await fetch(mailUpdatesUrl, {
      ...options,
      signal: AbortSignal.timeout(15_000),
    });
    await response.arrayBuffer();
    if (response.status !== 426) {
      throw new Error("The mail updates endpoint is unavailable.");
    }
  }
};

export const checkDeploymentWithRetry = async (
  ...args: Parameters<typeof checkDeployment>
) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await checkDeployment(...args);
      return;
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      await setTimeout(5000);
    }
  }
};

if (import.meta.main) {
  const [origin, buildId, mailUpdatesUrl] = process.argv.slice(2);
  if (!origin || !buildId) {
    throw new Error(
      "Usage: check-deployment.ts <origin> <expected-build-id> [mail-updates-url]"
    );
  }
  await checkDeploymentWithRetry(origin, buildId, mailUpdatesUrl);
  process.stdout.write(
    `Verified server, database, SSR and assets${mailUpdatesUrl ? ", and mail updates endpoint" : ""} for ${buildId}.\n`
  );
}
