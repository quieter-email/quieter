import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/o/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { handleMailOpenMarker } =
          await import("#/lib/mail-open-marker.server");
        return await handleMailOpenMarker(params.token);
      },
    },
  },
});
