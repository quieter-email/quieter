import { rpc } from "@quieter/app/lib/orpc";
import { queryOptions } from "@tanstack/react-query";

export const managedMailboxSettingsQueryOptions = (mailboxId: string) =>
  queryOptions({
    queryFn: async ({ signal }) =>
      await rpc.mail.getManagedMailboxDetails({ mailboxId }, { signal }),
    queryKey: ["mail", "managed-mailbox-details", mailboxId],
    staleTime: 30_000,
  });
