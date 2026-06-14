import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getGmailUsefulDetailsQueryKey = (mailboxId: string) =>
  ["gmail-useful-details", mailboxId] as const;

export const gmailUsefulDetailsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    queryKey: getGmailUsefulDetailsQueryKey(mailboxId),
    queryFn: ({ signal }) => rpc.mail.listGmailUsefulDetails({ mailboxId }, { signal }),
    enabled,
    staleTime: 1000 * 30,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
