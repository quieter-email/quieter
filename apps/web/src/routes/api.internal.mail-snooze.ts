import { createFileRoute } from "@tanstack/react-router";

import { handleMailSnoozeDispatch } from "#/lib/mail-snooze.server";

export const Route = createFileRoute("/api/internal/mail-snooze")({
  server: {
    handlers: {
      POST: async ({ request }) => await handleMailSnoozeDispatch(request),
    },
  },
});
