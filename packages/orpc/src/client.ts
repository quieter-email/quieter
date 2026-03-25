import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "./router";

type HeaderMap = Record<string, string>;

export type AppRouterClient = RouterClient<AppRouter>;

export function createOrpcClient(options?: {
  url?: string | URL;
  headers?: HeaderMap | (() => HeaderMap | Promise<HeaderMap>);
}): AppRouterClient {
  const headers = options?.headers;
  const link = new RPCLink({
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
export type { RouterInputs, RouterOutputs } from "./types";
