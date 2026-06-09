import { createFileRoute } from "@tanstack/react-router";
import { initializeConsentBackend } from "~/lib/c15t.server";

const handleConsentRequest = async (request: Request) => {
  const consentBackend = await initializeConsentBackend();
  return await consentBackend.handler(request);
};

export const Route = createFileRoute("/api/c15t/$")({
  server: {
    handlers: {
      DELETE: async ({ request }) => await handleConsentRequest(request),
      GET: async ({ request }) => await handleConsentRequest(request),
      PATCH: async ({ request }) => await handleConsentRequest(request),
      POST: async ({ request }) => await handleConsentRequest(request),
      PUT: async ({ request }) => await handleConsentRequest(request),
    },
  },
});
