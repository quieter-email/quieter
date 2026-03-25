import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createOrpcClient } from "@quietr/orpc";

export const createAppOrpcClient = () =>
  createOrpcClient({
    url: "/api/orpc",
  });

export const rpc = createAppOrpcClient();
export const orpc = createTanstackQueryUtils(rpc);
