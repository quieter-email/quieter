import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      DELETE: async ({ request }) => await handleMcpRequest(request),
      GET: async ({ request }) => await handleMcpRequest(request),
      OPTIONS: async ({ request }) => await handleMcpRequest(request),
      POST: async ({ request }) => await handleMcpRequest(request),
    },
  },
});

const handleMcpRequest = async (request: Request): Promise<Response> => {
  const { handleQuieterMcpRequest } = await import("#/lib/quieter-mcp.server");
  return await handleQuieterMcpRequest(request, waitUntil);
};
