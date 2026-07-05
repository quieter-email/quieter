import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const mailboxActionsListQueryKey = (mailboxId: string | undefined) =>
  ["mailbox-actions", mailboxId ?? ""] as const;

export const mailboxActionQueryKey = (actionId: string | undefined) =>
  ["mailbox-action", actionId ?? ""] as const;

export const linearMetadataQueryKey = (credentialId: string | undefined) =>
  ["mailbox-actions", "linear-metadata", credentialId ?? ""] as const;

export const mailboxActionsListQueryOptions = (mailboxId: string | undefined) =>
  queryOptions({
    enabled: !!mailboxId,
    queryFn: ({ signal }) => {
      if (!mailboxId) throw new Error("Mailbox id is required.");
      return rpc.mailboxActions.list({ mailboxId }, { signal });
    },
    queryKey: mailboxActionsListQueryKey(mailboxId),
    staleTime: 15_000,
  });

export const mailboxActionQueryOptions = (actionId: string | undefined) =>
  queryOptions({
    enabled: !!actionId,
    queryFn: ({ signal }) => {
      if (!actionId) throw new Error("Action id is required.");
      return rpc.mailboxActions.get({ actionId }, { signal });
    },
    queryKey: mailboxActionQueryKey(actionId),
    staleTime: 5_000,
  });

export const linearMetadataQueryOptions = (credentialId: string | undefined) =>
  queryOptions({
    enabled: !!credentialId,
    queryFn: ({ signal }) => {
      if (!credentialId) throw new Error("Linear credential id is required.");
      return rpc.mailboxActions.linearMetadata({ credentialId }, { signal });
    },
    queryKey: linearMetadataQueryKey(credentialId),
    staleTime: 60_000,
  });
