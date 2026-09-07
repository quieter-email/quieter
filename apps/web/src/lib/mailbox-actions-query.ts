import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export const mailboxActionsListQueryKey = (mailboxId: string | undefined) =>
  ["mailbox-actions", mailboxId ?? ""] as const;

export const mailboxActionQueryKey = (
  mailboxId: string | undefined,
  actionId: string | undefined
) => ["mailbox-action", mailboxId ?? "", actionId ?? ""] as const;

export const mailboxActionsListQueryOptions = (mailboxId: string | undefined) =>
  queryOptions({
    enabled: !!mailboxId,
    queryFn: async ({ signal }) => {
      if (!mailboxId) {
        throw new Error("Mailbox id is required.");
      }
      return await rpc.mailboxActions.list({ mailboxId }, { signal });
    },
    queryKey: mailboxActionsListQueryKey(mailboxId),
    staleTime: 15_000,
  });

export const mailboxActionQueryOptions = (
  mailboxId: string | undefined,
  actionId: string | undefined
) =>
  queryOptions({
    enabled: !!mailboxId && !!actionId,
    queryFn: async ({ signal }) => {
      if (!actionId) {
        throw new Error("Action id is required.");
      }
      return await rpc.mailboxActions.get({ actionId }, { signal });
    },
    queryKey: mailboxActionQueryKey(mailboxId, actionId),
    staleTime: 5000,
  });
