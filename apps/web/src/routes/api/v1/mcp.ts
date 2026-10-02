import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/mcp")({
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
  const { handleTransactionalMailMcpRequest } =
    await import("#/lib/transactional-mail-mcp.server");
  return await handleTransactionalMailMcpRequest(request);
};
