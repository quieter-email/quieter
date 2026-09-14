import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouterClient } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

import { queryKeys } from "./keys";

const MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS = 1000 * 60 * 30;
const MAILBOX_METADATA_STALE_MS = 1000 * 60;

export const createMailboxQueries = (client: AppRouterClient) => {
  const orpc = createTanstackQueryUtils(client);

  return {
    gmailUnreadCounts: (enabled = true) =>
      queryOptions({
        enabled,
        queryFn: async ({ signal }) =>
          await client.mail.listGmailUnreadCounts(undefined, { signal }),
        queryKey: queryKeys.gmailUnreadCounts(),
        refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
        refetchIntervalInBackground: false,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        staleTime: MAILBOX_METADATA_STALE_MS,
      }),
    list: (enabled = true) =>
      queryOptions({
        enabled,
        queryFn: async ({ signal }) =>
          await client.mail.listMailboxes(undefined, { signal }),
        queryKey: queryKeys.mailboxes(),
        refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
        refetchIntervalInBackground: false,
        refetchOnMount: false,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        staleTime: MAILBOX_METADATA_STALE_MS,
      }),
    mutations: {
      disconnectMailbox: orpc.mail.disconnectMailbox.mutationOptions(),
      setDefaultMailbox: orpc.mail.setDefaultMailbox.mutationOptions(),
      startGmailConnection: orpc.mail.startGmailConnection.mutationOptions(),
      updateGmailMailboxDisplayName:
        orpc.mail.updateGmailMailboxDisplayName.mutationOptions(),
      updateMailboxSignature:
        orpc.mail.updateMailboxSignature.mutationOptions(),
    },
  };
};

export type MailboxQueries = ReturnType<typeof createMailboxQueries>;
