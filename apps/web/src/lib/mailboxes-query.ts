import type { WorkspaceId } from "@quieter/auth/workspace";
import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getMailboxesQueryKey = (workspaceId: WorkspaceId) =>
  ["mailboxes", workspaceId] as const;

export const mailboxesQueryOptions = (workspaceId: WorkspaceId, enabled = true) =>
  queryOptions({
    queryKey: getMailboxesQueryKey(workspaceId),
    queryFn: ({ signal }) => rpc.mail.listMailboxesForActiveWorkspace(undefined, { signal }),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
