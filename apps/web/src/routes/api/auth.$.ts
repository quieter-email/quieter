import { createFileRoute } from "@tanstack/react-router";

const handleAuthRequest = async (request: Request) => {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");

  if (pathname === "/api/auth/polar/webhooks") {
    const { handlePolarWebhookRequest } = await import("@quieter/auth/polar-webhooks");
    return handlePolarWebhookRequest(request);
  }

  if (request.method === "GET" && pathname === "/api/auth/get-session") {
    const { handleSessionRequest } = await import("@quieter/auth/session");
    return handleSessionRequest(request);
  }

  const { auth } = await import("@quieter/auth");
  return auth.handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      DELETE: async ({ request }) => handleAuthRequest(request),
      GET: async ({ request }) => handleAuthRequest(request),
      PATCH: async ({ request }) => handleAuthRequest(request),
      POST: async ({ request }) => handleAuthRequest(request),
      PUT: async ({ request }) => handleAuthRequest(request),
    },
  },
});
