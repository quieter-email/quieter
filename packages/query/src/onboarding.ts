import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

export const createOnboardingQueries = (client: AppRouterClient) => {
  const orpc = createTanstackQueryUtils(client);

  return {
    mutations: {
      complete: orpc.onboarding.complete.mutationOptions(),
    },
    state: (enabled = true) =>
      queryOptions({
        enabled,
        queryFn: async ({ signal }) =>
          await client.onboarding.getState(undefined, { signal }),
        queryKey: ["onboarding", "state"] as const,
        staleTime: 1000 * 60 * 5,
      }),
  };
};

export type OnboardingQueries = ReturnType<typeof createOnboardingQueries>;
