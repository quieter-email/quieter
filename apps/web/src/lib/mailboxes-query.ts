import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getMailboxesQueryKey = () => ["mailboxes"] as const;
export const getGmailUnreadCountsQueryKey = () => ["gmail-unread-counts"] as const;

const MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS = 1000 * 60 * 30;
const MAILBOX_METADATA_STALE_MS = 1000 * 60;

export const mailboxesQueryOptions = (enabled = true) =>
  queryOptions({
    queryKey: getMailboxesQueryKey(),
    queryFn: ({ signal }) => rpc.mail.listMailboxes(undefined, { signal }),
    enabled,
    staleTime: MAILBOX_METADATA_STALE_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export const gmailUnreadCountsQueryOptions = (enabled = true) =>
  queryOptions({
    enabled,
    queryKey: getGmailUnreadCountsQueryKey(),
    queryFn: ({ signal }) => rpc.mail.listGmailUnreadCounts(undefined, { signal }),
    staleTime: MAILBOX_METADATA_STALE_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
