import { RPCHandler } from "@orpc/server/fetch";
import {
  RequestHeadersPlugin,
  ResponseHeadersPlugin,
} from "@orpc/server/plugins";
import { reportError as reportRuntimeError } from "@quieter/observability";

import type { OrpcContext } from "./context";
import { appRouter } from "./routers/index";

export { appRouter } from "./routers/index";

const logOrpcError = (
  error: unknown,
  reportError?: (error: unknown) => void
) => {
  if (reportError === undefined) {
    reportRuntimeError(error, { boundary: "orpc" });
    return;
  }

  reportError(error);
};

export const createOrpcHandler = (options?: {
  reportError?: (error: unknown) => void;
}): RPCHandler<OrpcContext> =>
  new RPCHandler(appRouter, {
    interceptors: [
      async (interceptorOptions) => {
        try {
          return await interceptorOptions.next();
        } catch (error) {
          logOrpcError(error, options?.reportError);
          throw error;
        }
      },
    ],
    plugins: [new RequestHeadersPlugin(), new ResponseHeadersPlugin()],
  });
