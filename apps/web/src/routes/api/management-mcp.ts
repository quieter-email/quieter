import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";

export const Route = createFileRoute("/api/management-mcp")({
  server: {
    handlers: {
      ANY: async ({ request }): Promise<Response> => {
        const [{ handleManagementMcpRequest }, { reportServerError }] =
          await Promise.all([
            import("#/lib/management-mcp.server"),
            import("#/lib/server-error-reporting"),
          ]);
        return await handleManagementMcpRequest(request, {
          reportError: (error) => {
            reportServerError(error, "management-mcp");
          },
          scheduleBackgroundTask: waitUntil,
        });
      },
    },
  },
});
