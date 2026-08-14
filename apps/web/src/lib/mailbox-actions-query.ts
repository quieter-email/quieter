import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

export const mailboxActionsListQueryKey = (mailboxId: string | undefined) =>
  ["mailbox-actions", mailboxId ?? ""] as const;

export const mailboxActionQueryKey = (
  mailboxId: string | undefined,
  actionId: string | undefined
) => ["mailbox-action", mailboxId ?? "", actionId ?? ""] as const;

export const mailboxActionsListQueryOptions = (mailboxId: string | undefined) =>
  queryOptions({
    enabled: hasText(mailboxId),
    queryFn: async ({ signal }) => {
      if (!hasText(mailboxId)) {
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
    enabled: hasText(mailboxId) && hasText(actionId),
    queryFn: async ({ signal }) => {
      if (!hasText(actionId)) {
        throw new Error("Action id is required.");
      }
      return await rpc.mailboxActions.get({ actionId }, { signal });
    },
    queryKey: mailboxActionQueryKey(mailboxId, actionId),
    staleTime: 5000,
  });
