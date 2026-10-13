import { createFileRoute } from "@tanstack/react-router";

export const handleDesktopRequest = async (
  request: Request
): Promise<Response> => {
  const [
    { OpenAPIHandler },
    { RequestHeadersPlugin, ResponseHeadersPlugin },
    { ORPCError },
    { createOrpcContext },
    { desktopRouter },
    { reportServerError },
  ] = await Promise.all([
    import("@orpc/openapi/fetch"),
    import("@orpc/server/plugins"),
    import("@orpc/server"),
    import("@quieter/orpc/context"),
    import("@quieter/orpc/desktop-router"),
    import("#/lib/server-error-reporting"),
  ]);
  const handler = new OpenAPIHandler(desktopRouter, {
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

  const result = response ?? new Response("Not Found", { status: 404 });
  result.headers.set("cache-control", "no-store");
  return result;
};

export const Route = createFileRoute("/api/desktop/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => await handleDesktopRequest(request),
    },
  },
});
