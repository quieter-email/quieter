import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export const getMailboxesQueryKey = () => ["mailboxes"] as const;
export const getGmailUnreadCountsQueryKey = () =>
  ["gmail-unread-counts"] as const;

const MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS = 1000 * 60 * 30;
const MAILBOX_METADATA_STALE_MS = 1000 * 60;

export const mailboxesQueryOptions = (enabled = true) =>
  queryOptions({
    enabled,
    queryFn: async ({ signal }) =>
      await rpc.mail.listMailboxes(undefined, { signal }),
    queryKey: getMailboxesQueryKey(),
    refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: MAILBOX_METADATA_STALE_MS,
  });

export const gmailUnreadCountsQueryOptions = (enabled = true) =>
  queryOptions({
    enabled,
    queryFn: async ({ signal }) =>
      await rpc.mail.listGmailUnreadCounts(undefined, { signal }),
    queryKey: getGmailUnreadCountsQueryKey(),
    refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: MAILBOX_METADATA_STALE_MS,
  });
