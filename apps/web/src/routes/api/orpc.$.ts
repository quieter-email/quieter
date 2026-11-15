import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";

export const Route = createFileRoute("/api/orpc/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const startedAt = performance.now();
        const [
          { ORPCError },
          { createOrpcContext },
          { createOrpcHandler },
          { reportServerError },
        ] = await Promise.all([
          import("@orpc/server"),
          import("@quieter/orpc/context"),
          import("@quieter/orpc/server"),
          import("#/lib/server-error-reporting"),
        ]);
        const orpcHandler = createOrpcHandler({
          reportError: (error) => {
            if (error instanceof ORPCError && error.status < 500) {
              return;
            }
            reportServerError(error, "orpc");
          },
        });
        const { response } = await orpcHandler.handle(request, {
          context: createOrpcContext({
            req: request,
            scheduleBackgroundTask: waitUntil,
          }),
          prefix: "/api/orpc",
        });

        const result = response ?? new Response("Not Found", { status: 404 });
        result.headers.append(
          "Server-Timing",
          `rpc;dur=${(performance.now() - startedAt).toFixed(1)}`
        );
        return result;
      },
    },
  },
});
