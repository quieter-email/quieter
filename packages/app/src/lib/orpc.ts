import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createOrpcClient } from "@quieter/orpc";
import type { AppRouterClient } from "@quieter/orpc";

import { getApiUrl } from "../runtime";

// oxlint-disable-next-line import/no-mutable-exports -- Each host configures its request transport before rendering.
export let rpc: AppRouterClient = createOrpcClient({
  url: () => getApiUrl("/api/orpc"),
});
// oxlint-disable-next-line import/no-mutable-exports -- Query utilities must use the host's configured client.
export let orpc = createTanstackQueryUtils(rpc);

export const configureAppOrpcClient = (client: AppRouterClient) => {
  rpc = client;
  orpc = createTanstackQueryUtils(client);
};
