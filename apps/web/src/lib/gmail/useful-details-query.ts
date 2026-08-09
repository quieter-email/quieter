import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";
import { isSandboxMailboxId } from "#/lib/sandbox-mailbox";

export const getGmailUsefulDetailsQueryKey = (mailboxId: string) =>
  ["gmail-useful-details", mailboxId] as const;

export const getGmailThreadUsefulDetailsQueryKey = (
  mailboxId: string,
  gmailThreadId: string
) => ["gmail-useful-details", mailboxId, "thread", gmailThreadId] as const;

export const gmailUsefulDetailsQueryOptions = (
  mailboxId: string,
  enabled = true
) =>
  queryOptions({
    enabled: enabled && !isSandboxMailboxId(mailboxId),
    queryFn: async ({ signal }) =>
      await rpc.mail.listGmailUsefulDetails({ mailboxId }, { signal }),
    queryKey: getGmailUsefulDetailsQueryKey(mailboxId),
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    staleTime: 1000 * 30,
  });

export const gmailThreadUsefulDetailsQueryOptions = (
  mailboxId: string,
  gmailThreadId: string,
  enabled = true
) =>
  queryOptions({
    enabled: enabled && !isSandboxMailboxId(mailboxId),
    queryFn: async ({ signal }) =>
      await rpc.mail.listGmailThreadUsefulDetails(
        { gmailThreadId, mailboxId },
        { signal }
      ),
    queryKey: getGmailThreadUsefulDetailsQueryKey(mailboxId, gmailThreadId),
    staleTime: 1000 * 30,
  });
