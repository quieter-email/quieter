import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@quieter/orpc";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createOrpcClient } from "@quieter/orpc";
import { createOrpcServerClient } from "@quieter/orpc/server-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

const getOrpcClient = createIsomorphicFn()
  .server(() =>
    createOrpcServerClient({
      headers: () => getRequestHeaders(),
    }),
  )
  .client(
    (): RouterClient<AppRouter> =>
      createOrpcClient({
        url: `${window.location.origin}/api/orpc`,
      }),
  );

export const rpc: RouterClient<AppRouter> = getOrpcClient();
export const orpc = createTanstackQueryUtils(rpc);
