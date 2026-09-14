import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

import { queryKeys } from "./keys";

export const createTemplateQueries = (client: AppRouterClient) => {
  const orpc = createTanstackQueryUtils(client);

  return {
    list: (mailboxId: string) =>
      queryOptions({
        queryFn: async ({ signal }) =>
          await client.mailTemplates.list({ mailboxId }, { signal }),
        queryKey: queryKeys.templates(mailboxId),
        staleTime: 1000 * 60 * 5,
      }),
    mutations: {
      create: orpc.mailTemplates.create.mutationOptions(),
      delete: orpc.mailTemplates.delete.mutationOptions(),
      update: orpc.mailTemplates.update.mutationOptions(),
    },
  };
};

export type TemplateQueries = ReturnType<typeof createTemplateQueries>;
