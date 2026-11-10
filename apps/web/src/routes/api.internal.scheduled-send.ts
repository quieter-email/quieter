import { createFileRoute } from "@tanstack/react-router";

import { handleScheduledSendDispatch } from "#/lib/scheduled-send.server";

export const Route = createFileRoute("/api/internal/scheduled-send")({
  server: {
    handlers: {
      POST: async ({ request }) => await handleScheduledSendDispatch(request),
    },
  },
});
