import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/control/mcp")({
  server: {
    handlers: {
      DELETE: async ({ request }): Promise<Response> =>
        await handleRequest(request),
      GET: async ({ request }): Promise<Response> =>
        await handleRequest(request),
      OPTIONS: async ({ request }): Promise<Response> =>
        await handleRequest(request),
      POST: async ({ request }): Promise<Response> =>
        await handleRequest(request),
    },
  },
});

const handleRequest = async (request: Request): Promise<Response> => {
  const { handleControlMcpRequest } = await import("#/lib/control-mcp.server");
  return await handleControlMcpRequest(request);
};
