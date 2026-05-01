import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getMailboxesQueryKey = () => ["mailboxes"] as const;

export const mailboxesQueryOptions = (enabled = true) =>
  queryOptions({
    queryKey: getMailboxesQueryKey(),
    queryFn: ({ signal }) => rpc.mail.listMailboxes(undefined, { signal }),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
