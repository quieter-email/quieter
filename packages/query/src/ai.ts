import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

import { queryKeys } from "./keys";

export const createAiQueries = (client: AppRouterClient) => {
  const orpc = createTanstackQueryUtils(client);

  return {
    mutations: {
      resetPersonalization: orpc.ai.resetPersonalization.mutationOptions(),
      updatePersonalization: orpc.ai.updatePersonalization.mutationOptions(),
    },
    settings: () =>
      queryOptions({
        queryFn: async ({ signal }) =>
          await client.ai.settings(undefined, { signal }),
        queryKey: queryKeys.aiSettings(),
        staleTime: 1000 * 60 * 5,
      }),
  };
};

export type AiQueries = ReturnType<typeof createAiQueries>;
