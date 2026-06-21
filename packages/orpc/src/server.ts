import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins";
import { appRouter } from "./routers/index";

export const createOrpcHandler = (options?: { reportError?: (error: unknown) => void }) =>
  new RPCHandler(appRouter, {
    interceptors: [
      onError((error) => {
        if (options?.reportError) {
          options.reportError(error);
        } else {
          console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
        }
      }),
    ],
    plugins: [new RequestHeadersPlugin(), new ResponseHeadersPlugin()],
  });

export { appRouter };
