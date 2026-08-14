import { createFileRoute } from "@tanstack/react-router";

const handleAuthRequest = async (request: Request) => {
  const pathname = new URL(request.url).pathname.replace(/\/+$/u, "");

  if (pathname === "/api/auth/polar/webhooks") {
    const { handlePolarWebhookRequest } =
      await import("@quieter/auth/polar-webhooks");
    return await handlePolarWebhookRequest(request);
  }

  if (request.method === "GET" && pathname === "/api/auth/get-session") {
    const { handleSessionRequest } = await import("@quieter/auth/session");
    return await handleSessionRequest(request);
  }

  const { auth } = await import("@quieter/auth");
  return await auth.handler(request);
};

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      DELETE: async ({ request }) => await handleAuthRequest(request),
      GET: async ({ request }) => await handleAuthRequest(request),
      PATCH: async ({ request }) => await handleAuthRequest(request),
      POST: async ({ request }) => await handleAuthRequest(request),
      PUT: async ({ request }) => await handleAuthRequest(request),
    },
  },
});
