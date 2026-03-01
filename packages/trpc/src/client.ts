import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./router";
import type { RouterInputs, RouterOutputs } from "./types";

type HeaderMap = Record<string, string>;

export function createTrpcClient(options?: {
  url?: string;
  headers?: HeaderMap | (() => HeaderMap | Promise<HeaderMap>);
}) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: options?.url ?? "/api/trpc",
        headers: options?.headers,
      }),
    ],
  });
}

export type { AppRouter, RouterInputs, RouterOutputs };
