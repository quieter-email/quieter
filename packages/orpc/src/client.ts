import type { InferClientInputs, InferClientOutputs } from "@orpc/client";
import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "./routers/index";

type HeaderMap = Record<string, string>;
type OrpcClientContext = Record<never, never>;

export type AppRouterClient = RouterClient<AppRouter, OrpcClientContext>;
export type RouterInputs = InferClientInputs<AppRouterClient>;
export type RouterOutputs = InferClientOutputs<AppRouterClient>;

export function createOrpcClient(options?: {
  url?: string | URL;
  headers?: HeaderMap | (() => HeaderMap | Promise<HeaderMap>);
}): AppRouterClient {
  const headers = options?.headers;
  const link = new RPCLink<OrpcClientContext>({
    url: options?.url ?? "/api/orpc",
    headers:
      headers == null
        ? undefined
        : async (_options, _path, _input) =>
            typeof headers === "function" ? await headers() : headers,
  });

  return createORPCClient<AppRouterClient>(link);
}

export type { AppRouter };
