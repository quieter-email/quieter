import { auth } from "@quietr/auth";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      DELETE: async ({ request }) => await auth.handler(request),
      GET: async ({ request }) => await auth.handler(request),
      PATCH: async ({ request }) => await auth.handler(request),
      POST: async ({ request }) => await auth.handler(request),
      PUT: async ({ request }) => await auth.handler(request),
    },
  },
});
