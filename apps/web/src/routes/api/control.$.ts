import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";

export const Route = createFileRoute("/api/control/$")({
  server: {
    handlers: {
      ANY: async ({ request }): Promise<Response> => {
        const [{ handleControlHttpRequest }, { reportServerError }] =
          await Promise.all([
            import("@quieter/orpc/control/http"),
            import("#/lib/server-error-reporting"),
          ]);
        return await handleControlHttpRequest(request, {
          reportError: (error) => {
            reportServerError(error, "management-control");
          },
          scheduleBackgroundTask: waitUntil,
        });
      },
    },
  },
});
