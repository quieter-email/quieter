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

export const gmailThreadUsefulDetailsQueryOptions = (
  mailboxId: string,
  gmailThreadId: string,
  enabled = true,
) =>
  queryOptions({
    queryKey: ["gmail-useful-details", mailboxId, "thread", gmailThreadId],
    queryFn: ({ signal }) =>
      rpc.mail.listGmailThreadUsefulDetails({ gmailThreadId, mailboxId }, { signal }),
    enabled,
    staleTime: 1000 * 30,
  });
