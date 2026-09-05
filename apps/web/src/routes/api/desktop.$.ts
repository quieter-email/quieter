import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/desktop/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const [
          { OpenAPIHandler },
          { RequestHeadersPlugin, ResponseHeadersPlugin },
          { ORPCError },
          { createOrpcContext },
          { appRouter },
          { reportServerError },
        ] = await Promise.all([
          import("@orpc/openapi/fetch"),
          import("@orpc/server/plugins"),
          import("@orpc/server"),
          import("@quieter/orpc/context"),
          import("@quieter/orpc/router"),
          import("#/lib/server-error-reporting"),
        ]);
        const handler = new OpenAPIHandler(appRouter, {
          interceptors: [
            async (options) => {
              try {
                return await options.next();
              } catch (error) {
                if (!(error instanceof ORPCError) || error.status >= 500) {
                  reportServerError(error, "desktop-api");
                }
                throw error;
              }
            },
          ],
          plugins: [new RequestHeadersPlugin(), new ResponseHeadersPlugin()],
        });
        const { response } = await handler.handle(request, {
          context: createOrpcContext({ req: request }),
          prefix: "/api/desktop",
        });

        return response ?? new Response("Not Found", { status: 404 });
      },
    },
  },
});
