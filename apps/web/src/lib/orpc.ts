import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@quietr/orpc";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

declare global {
  var $client: RouterClient<AppRouter> | undefined;
}

const link = new RPCLink({
  url: () => {
    if (typeof window === "undefined") {
      throw new Error("RPCLink is not allowed on the server side.");
    }

    return `${window.location.origin}/api/orpc`;
  },
});

export const rpc: RouterClient<AppRouter> = globalThis.$client ?? createORPCClient(link);
export const orpc = createTanstackQueryUtils(rpc);
