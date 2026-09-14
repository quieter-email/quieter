import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

import { queryKeys } from "./keys";

export const createChatQueries = (client: AppRouterClient) => {
  const orpc = createTanstackQueryUtils(client);

  return {
    list: (mailboxId: string) =>
      queryOptions({
        queryFn: async ({ signal }) =>
          await client.chat.list({ mailboxId }, { signal }),
        queryKey: queryKeys.chats(mailboxId),
        staleTime: 1000 * 60,
      }),
    mutations: {
      cancel: orpc.chat.cancel.mutationOptions(),
      delete: orpc.chat.delete.mutationOptions(),
      rename: orpc.chat.rename.mutationOptions(),
    },
  };
};

export type ChatQueries = ReturnType<typeof createChatQueries>;
