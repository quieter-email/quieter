import { createFileRoute } from "@tanstack/react-router";
import { initializeConsentBackend } from "~/lib/c15t.server";

const handleConsentRequest = async (request: Request) => {
  const consentBackend = await initializeConsentBackend();
  return consentBackend.handler(request);
};

export const Route = createFileRoute("/api/c15t/$")({
  server: {
    handlers: {
      DELETE: ({ request }) => handleConsentRequest(request),
      GET: ({ request }) => handleConsentRequest(request),
      PATCH: ({ request }) => handleConsentRequest(request),
      POST: ({ request }) => handleConsentRequest(request),
      PUT: ({ request }) => handleConsentRequest(request),
    },
  },
});
