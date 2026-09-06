import { parseReleaseProbeBindings } from "@quieter/env/deployment";

export default {
  async fetch(request: Request, bindings: unknown) {
    const env = parseReleaseProbeBindings(bindings);
    if (request.headers.get("authorization") !== `Bearer ${env.PROBE_TOKEN}`) {
      return new Response(null, { status: 404 });
    }
    if (new URL(request.url).pathname === "/__release/health") {
      const asset = await env.ASSETS?.fetch(
        new Request(new URL("/assets/probe-abcdef12.js", request.url))
      );
      const assetBody = await asset?.text();
      return Response.json(
        {
          checks: {
            assets:
              asset?.status === 200 &&
              assetBody?.trim() === 'export const releaseProbe = "baseline";',
            ready: true,
          },
          versionId: env.PROBE_VERSION.id,
        },
        { headers: { "cache-control": "no-store" } }
      );
    }
    if (new URL(request.url).pathname.startsWith("/assets/")) {
      return (
        (await env.ASSETS?.fetch(request)) ??
        new Response(null, { status: 404 })
      );
    }
    return Response.json(
      { generation: env.PROBE_GENERATION },
      { headers: { "cache-control": "no-store" } }
    );
  },
};
