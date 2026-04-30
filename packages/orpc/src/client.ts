import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import type { RouterClient } from "@orpc/server";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { ClientRetryPlugin, type ClientRetryPluginContext } from "@orpc/client/plugins";
import type { AppRouter } from "./router";

type HeaderMap = Record<string, string>;
type OrpcClientContext = ClientRetryPluginContext;

export type AppRouterClient = RouterClient<AppRouter, OrpcClientContext>;
export type RouterInputs = InferClientInputs<AppRouterClient>;
export type RouterOutputs = InferClientOutputs<AppRouterClient>;
const GET_METHOD_PATHS = new Set([
  "auth.getUserStatus",
  "mail.getAttachment",
  "mail.getGoogleScopeRepairTarget",
  "mail.getMailboxSyncDelta",
  "mail.getMessageInspector",
  "mail.getThread",
  "mail.listLabels",
  "mail.listMailboxesForActiveWorkspace",
  "mail.listMessages",
]);

const toProcedurePath = (path: readonly string[] | string): string =>
  typeof path === "string" ? path : path.join(".");

const inferMethod = async (_input: unknown, path: readonly string[] | string) => {
  return GET_METHOD_PATHS.has(toProcedurePath(path)) ? "GET" : "POST";
};

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
    method: inferMethod,
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
