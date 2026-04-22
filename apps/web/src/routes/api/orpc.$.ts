import { createOrpcContext } from "@quieter/orpc/context";
import { orpcHandler } from "@quieter/orpc/server";
import { createFileRoute } from "@tanstack/react-router";

const endpoint = "/api/orpc" as const;

export const Route = createFileRoute("/api/orpc/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const { response } = await orpcHandler.handle(request, {
          context: createOrpcContext({ req: request }),
          prefix: endpoint,
        });

        return response ?? new Response("Not Found", { status: 404 });
      },
    },
  },
});
