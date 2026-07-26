import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const managedMailboxSettingsQueryOptions = (mailboxId: string) =>
  queryOptions({
    queryFn: ({ signal }) => rpc.mail.getManagedMailboxDetails({ mailboxId }, { signal }),
    queryKey: ["mail", "managed-mailbox-details", mailboxId],
    staleTime: 30_000,
  });
