import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/orpc/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const [{ ORPCError }, { createOrpcContext }, { createOrpcHandler }, { reportServerError }] =
          await Promise.all([
            import("@orpc/server"),
            import("@quieter/orpc/context"),
            import("@quieter/orpc/server"),
            import("~/lib/server-error-reporting"),
          ]);
        const orpcHandler = createOrpcHandler({
          reportError: (error) => {
            if (error instanceof ORPCError && error.status < 500) return;
            reportServerError(error, "orpc");
          },
        });
        const { response } = await orpcHandler.handle(request, {
          context: createOrpcContext({ req: request }),
          prefix: "/api/orpc",
        });

        return response ?? new Response("Not Found", { status: 404 });
      },
    },
  },
});
