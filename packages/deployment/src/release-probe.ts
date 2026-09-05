import { parseReleaseProbeBindings } from "@quieter/env/deployment";

export default {
  fetch(request: Request, bindings: unknown) {
    const env = parseReleaseProbeBindings(bindings);
    if (request.headers.get("authorization") !== `Bearer ${env.PROBE_TOKEN}`) {
      return new Response(null, { status: 404 });
    }
    return Response.json(
      { generation: env.PROBE_GENERATION },
      { headers: { "cache-control": "no-store" } }
    );
  },
};
