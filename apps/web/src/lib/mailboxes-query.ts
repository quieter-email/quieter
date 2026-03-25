import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getMailboxesQueryKey = (activeOrganizationId: string | null | undefined) =>
  ["mailboxes", activeOrganizationId ?? "none"] as const;

export const mailboxesQueryOptions = (
  activeOrganizationId: string | null | undefined,
  enabled = true,
) =>
  queryOptions({
    queryKey: getMailboxesQueryKey(activeOrganizationId),
    queryFn: ({ signal }) => rpc.mail.listMailboxesForActiveOrganization(undefined, { signal }),
    enabled: enabled && Boolean(activeOrganizationId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
