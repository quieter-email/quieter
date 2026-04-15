import "server-only";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@quietr/orpc";
import { createRouterClient } from "@orpc/server";
import { createOrpcContext } from "@quietr/orpc/context";
import { appRouter } from "@quietr/orpc/router";
import { headers } from "next/headers";

declare global {
  var $client: RouterClient<AppRouter> | undefined;
}

globalThis.$client = createRouterClient(appRouter, {
  context: async () =>
    createOrpcContext({
      headers: await headers(),
    }),
});
