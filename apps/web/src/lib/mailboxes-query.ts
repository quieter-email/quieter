import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";

export const getMailboxesQueryKey = () => ["mailboxes"] as const;

const MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS = 1000 * 60 * 30;

export const mailboxesQueryOptions = (enabled = true) =>
  queryOptions({
    queryKey: getMailboxesQueryKey(),
    queryFn: ({ signal }) => rpc.mail.listMailboxes(undefined, { signal }),
    enabled,
    persister: queryPersister.persisterFn,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
