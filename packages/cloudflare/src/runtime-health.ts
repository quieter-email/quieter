import { timingSafeEqual } from "node:crypto";

import { createRuntimeHealthEnv } from "@quieter/env/runtime-health";
import type { RuntimeHealthBindings } from "@quieter/env/runtime-health";

export const handleRuntimeHealthRequest = (
  request: Request,
  env: RuntimeHealthBindings
): Response | null => {
  const url = new URL(request.url);
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  try {
    const configuration = createRuntimeHealthEnv(env);
    if (url.pathname !== "/__release/health") {
      return configuration === null ||
        configuration.publicHosts.includes(url.hostname)
        ? null
        : new Response("Not found.", { headers, status: 404 });
    }
    if (request.method === "GET" && configuration !== null) {
      const supplied = new TextEncoder().encode(
        request.headers.get("authorization") ?? ""
      );
      const expected = new TextEncoder().encode(
        `Bearer ${configuration.token}`
      );
      if (
        supplied.byteLength === expected.byteLength &&
        timingSafeEqual(supplied, expected)
      ) {
        return Response.json(
          {
            checks: { startup: true },
            versionId: configuration.versionId,
          },
          { headers }
        );
      }
    }
  } catch {
    // Broken or incomplete bindings must never produce healthy evidence.
  }
  return new Response("Not found.", { headers, status: 404 });
};
