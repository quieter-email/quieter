import { createFileRoute } from "@tanstack/react-router";

const handleWellKnownRequest = async (request: Request) => {
  const { handleMcpOAuthRequest } = await import("@quieter/auth/mcp-oauth");
  return (
    (await handleMcpOAuthRequest(request)) ??
    Response.json({ error: "Not found." }, { status: 404 })
  );
};

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      GET: async ({ request }) => await handleWellKnownRequest(request),
      HEAD: async ({ request }) => await handleWellKnownRequest(request),
      OPTIONS: async ({ request }) => await handleWellKnownRequest(request),
    },
  },
});
