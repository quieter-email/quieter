import { createFileRoute } from "@tanstack/react-router";

import { reportServerError } from "#/lib/server-error-reporting";

export const Route = createFileRoute("/api/review-health")({
  server: {
    handlers: {
      GET: async () => {
        const { serverEnv } = await import("@quieter/env/server");

        if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "preview") {
          return new Response(null, { status: 404 });
        }

        try {
          const [
            { withRequestDatabaseClient },
            { assertReviewDatabaseSchema },
          ] = await Promise.all([
            import("@quieter/database/client"),
            import("@quieter/orpc/review-health"),
          ]);

          await withRequestDatabaseClient(async (client) => {
            await assertReviewDatabaseSchema(client);
          });

          return new Response(null, {
            headers: { "cache-control": "no-store" },
            status: 204,
          });
        } catch (error) {
          reportServerError(error, "review-health");

          return new Response(null, {
            headers: { "cache-control": "no-store" },
            status: 503,
          });
        }
      },
    },
  },
});
