import type { QueryClient } from "@tanstack/react-query";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import { rpc } from "~/lib/orpc";

export const openGoogleAccountLink = async (input: {
  mailboxId?: string;
  organizationId?: string;
  queryClient: QueryClient;
  returnTo: string;
}) => {
  const { authorizationUrl } = await rpc.mail.startGmailConnection({
    mailboxId: input.mailboxId,
    organizationId: input.organizationId,
    returnTo: input.returnTo,
  });
  await input.queryClient.invalidateQueries({
    exact: true,
    queryKey: getMailboxesQueryKey(),
    refetchType: "none",
  });
  window.location.replace(authorizationUrl);
};
