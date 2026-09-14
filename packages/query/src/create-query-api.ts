import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@quieter/orpc";

import { createAiQueries } from "./ai";
import { createChatQueries } from "./chats";
import { queryKeys } from "./keys";
import { createMailQueries, invalidateMailQuery } from "./mail";
import { createMailboxQueries } from "./mailboxes";
import { createOnboardingQueries } from "./onboarding";
import { createTemplateQueries } from "./templates";

/**
 * One query surface for every shell. Web, native, and desktop clients pass
 * their own oRPC client (cookies, bearer, or custom fetch) and get identical
 * query keys, stale policies, and mutation options.
 */
export const createQueryApi = (client: AppRouterClient) => ({
  ai: createAiQueries(client),
  chats: createChatQueries(client),
  client,
  invalidate: {
    mail: invalidateMailQuery,
  },
  keys: queryKeys,
  mail: createMailQueries(client),
  mailboxes: createMailboxQueries(client),
  onboarding: createOnboardingQueries(client),
  orpc: createTanstackQueryUtils(client),
  templates: createTemplateQueries(client),
});

export type QueryApi = ReturnType<typeof createQueryApi>;
