import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { ClientRetryPlugin, type ClientRetryPluginContext } from "@orpc/client/plugins";
import { inferRPCMethodFromRouter, type RouterClient } from "@orpc/server";
import { appRouter, type AppRouter } from "./router";

type HeaderMap = Record<string, string>;
type OrpcClientContext = ClientRetryPluginContext;

export type AppRouterClient = RouterClient<AppRouter, OrpcClientContext>;
const inferMethod = inferRPCMethodFromRouter(appRouter);

const isConservativeRetryableError = (error: unknown) => {
  if (error instanceof ORPCError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }

  return error instanceof Error && error.name === "TypeError";
};

export function createOrpcClient(options?: {
  url?: string | URL;
  headers?: HeaderMap | (() => HeaderMap | Promise<HeaderMap>);
}): AppRouterClient {
  const headers = options?.headers;
  const link = new RPCLink<OrpcClientContext>({
    url: options?.url ?? "/api/orpc",
    method: inferRPCMethodFromRouter(appRouter),
    headers:
      headers == null
        ? undefined
        : async (_options, _path, _input) =>
            typeof headers === "function" ? await headers() : headers,
    plugins: [
      new ClientRetryPlugin({
        default: {
          retry: async ({ path }) => ((await inferMethod(undefined, path)) === "GET" ? 1 : 0),
          retryDelay: ({ attemptIndex }) => 250 * (attemptIndex + 1),
          shouldRetry: async ({ error, path }) => {
            return (
              (await inferMethod(undefined, path)) === "GET" && isConservativeRetryableError(error)
            );
          },
        },
      }),
    ],
  });

  return createORPCClient<AppRouterClient>(link);
}

export type { AppRouter };
export type { RouterInputs, RouterOutputs } from "./types";
