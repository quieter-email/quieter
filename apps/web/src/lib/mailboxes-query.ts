import { queryOptions } from "@tanstack/react-query";
import { trpc } from "~/lib/trpc";

export const getMailboxesQueryKey = (activeOrganizationId: string | null | undefined) =>
  ["mailboxes", activeOrganizationId ?? "none"] as const;

export const mailboxesQueryOptions = (
  activeOrganizationId: string | null | undefined,
  enabled = true,
) =>
  queryOptions({
    queryKey: getMailboxesQueryKey(activeOrganizationId),
    queryFn: ({ signal }) =>
      trpc.mail.listMailboxesForActiveOrganization.query(undefined, { signal }),
    enabled: enabled && Boolean(activeOrganizationId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
