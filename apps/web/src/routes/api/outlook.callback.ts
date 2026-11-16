import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/outlook/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleOutlookCallback } =
          await import("@quieter/orpc/outlook/callback");
        return await handleOutlookCallback(request);
      },
    },
  },
});
