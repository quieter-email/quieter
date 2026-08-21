import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "@quieter/orpc";
import { createOrpcClient } from "@quieter/orpc";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";

const getOrpcClient = createIsomorphicFn()
  .server(() =>
    createOrpcClient({
      headers: () => Object.fromEntries(getRequestHeaders()),
      url: () => new URL("/api/orpc", getRequest().url),
    })
  )
  .client((): RouterClient<AppRouter> =>
    createOrpcClient({
      url: `${window.location.origin}/api/orpc`,
    })
  );

export const rpc: RouterClient<AppRouter> = getOrpcClient();
export const orpc = createTanstackQueryUtils(rpc);
