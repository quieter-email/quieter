import { ORPCError } from "@orpc/server";
import { createOrpcContext } from "@quieter/orpc/context";
import { createOrpcHandler } from "@quieter/orpc/server";
import { createFileRoute } from "@tanstack/react-router";
import { reportServerError } from "~/lib/server-error-reporting";

const orpcHandler = createOrpcHandler({
  reportError: (error) => {
    if (error instanceof ORPCError && error.status < 500) return;
    reportServerError(error, "orpc");
  },
});

export const Route = createFileRoute("/api/orpc/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const { response } = await orpcHandler.handle(request, {
          context: createOrpcContext({ req: request }),
          prefix: "/api/orpc",
        });

        return response ?? new Response("Not Found", { status: 404 });
      },
    },
  },
});
