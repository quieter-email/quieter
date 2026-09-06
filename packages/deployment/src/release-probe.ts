import { parseReleaseProbeBindings } from "@quieter/env/deployment";

export default {
  async fetch(request: Request, bindings: unknown) {
    const env = parseReleaseProbeBindings(bindings);
    if (request.headers.get("authorization") !== `Bearer ${env.PROBE_TOKEN}`) {
      return new Response(null, { status: 404 });
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
