import { onError } from "@orpc/server";
import { BodyLimitPlugin, CompressionPlugin, RPCHandler } from "@orpc/server/fetch";
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins";
import { createOrpcContext } from "./context";
import { appRouter } from "./router";

const compressionPlugin =
  typeof CompressionStream === "function"
    ? new CompressionPlugin({
        threshold: 2 * 1024,
      })
    : null;

const handler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
  plugins: [
    new RequestHeadersPlugin(),
    new ResponseHeadersPlugin(),
    ...(compressionPlugin ? [compressionPlugin] : []),
    new BodyLimitPlugin({
      maxBodySize: 30 * 1024 * 1024,
    }),
  ],
});

export async function handleOrpcRequest(req: Request, endpoint: `/${string}` = "/api/orpc") {
  const { response } = await handler.handle(req, {
    context: createOrpcContext({ req }),
    prefix: endpoint,
  });

  return response ?? new Response("Not found", { status: 404 });
}

export { appRouter };
