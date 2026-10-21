import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/desktop/session")({
  server: {
    handlers: {
      GET: async ({ request }): Promise<Response> => {
        const { getSessionUserForRequest } = await import("#/lib/auth.server");
        return Response.json(await getSessionUserForRequest(request), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
