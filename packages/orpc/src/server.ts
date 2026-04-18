import { onError } from "@orpc/server";
import { BodyLimitPlugin, CompressionPlugin, RPCHandler } from "@orpc/server/fetch";
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins";
import { appRouter } from "./router";

const compressionPlugin =
  typeof CompressionStream === "function"
    ? new CompressionPlugin({
        threshold: 2 * 1024,
      })
    : null;

export const orpcHandler = new RPCHandler(appRouter, {
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

export { appRouter };
