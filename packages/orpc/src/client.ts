import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";

import type { AppRouter } from "./routers/index";

type HeaderMap = Record<string, string>;
type OrpcClientContext = Record<never, never>;
type UrlSource = string | URL | (() => string | URL | Promise<string | URL>);

export type { AppRouter } from "./routers/index";
export type AppRouterClient = RouterClient<AppRouter, OrpcClientContext>;
export type RouterInputs = InferClientInputs<AppRouterClient>;
export type RouterOutputs = InferClientOutputs<AppRouterClient>;

export const createOrpcClient = (options?: {
  url?: UrlSource;
  headers?: HeaderMap | (() => HeaderMap | Promise<HeaderMap>);
}): AppRouterClient => {
  const headers = options?.headers;
  const link = new RPCLink<OrpcClientContext>({
    headers:
      headers === undefined
        ? undefined
        : async (_options, _path, _input) =>
            typeof headers === "function" ? await headers() : headers,
    url: options?.url ?? "/api/orpc",
  });

  return createORPCClient<AppRouterClient>(link);
};
