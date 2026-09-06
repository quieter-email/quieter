import type { DurableObjectState } from "@cloudflare/workers-types";
import {
  parseReleaseDurableProbeBindings,
  parseReleaseProbeBindings,
} from "@quieter/env/deployment";

export class ReleaseCounter {
  private readonly state: DurableObjectState;
  private readonly bindings: unknown;

  constructor(state: DurableObjectState, bindings: unknown) {
    this.state = state;
    this.bindings = bindings;
  }

  async fetch(request: Request) {
    const env = parseReleaseProbeBindings(this.bindings);
    const count = await this.state.storage.transaction(async (transaction) => {
      const previous = (await transaction.get<number>("count")) ?? 0;
      if (!Number.isSafeInteger(previous) || previous < 0) {
        throw new Error("Invalid retained synthetic counter.");
      }
      const next = previous + (request.method === "POST" ? 1 : 0);
      if (next !== previous) {
        await transaction.put("count", next);
      }
      return next;
    });
    return Response.json({
      count,
      generation: env.PROBE_GENERATION,
      versionId: env.PROBE_VERSION.id,
    });
  }
}

export default {
  async fetch(request: Request, bindings: unknown) {
    const env = parseReleaseDurableProbeBindings(bindings);
    if (request.headers.get("authorization") !== `Bearer ${env.PROBE_TOKEN}`) {
      return new Response(null, { status: 404 });
    }
    if (!["GET", "POST"].includes(request.method)) {
      return new Response(null, { status: 405 });
    }
    const response = await env.ReleaseCounter.getByName("release-proof").fetch(
      new Request("https://counter.invalid/", { method: request.method })
    );
    return new Response(await response.text(), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        "x-worker-version": env.PROBE_VERSION.id,
      },
      status: response.status,
    });
  },
};
