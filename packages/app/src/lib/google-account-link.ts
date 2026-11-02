import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import { rpc } from "@quieter/app/lib/orpc";
import { openExternalUrl } from "@quieter/app/runtime";
import type { QueryClient } from "@tanstack/react-query";

export const openGoogleAccountLink = async (input: {
  loginHint?: string;
  mailboxId?: string;
  organizationId?: string;
  queryClient: QueryClient;
  returnTo: string;
}) => {
  const { authorizationUrl } = await rpc.mail.startGmailConnection({
    loginHint: input.loginHint,
    mailboxId: input.mailboxId,
    organizationId: input.organizationId,
    returnTo: input.returnTo,
  });
  await input.queryClient.invalidateQueries({
    exact: true,
    queryKey: getMailboxesQueryKey(),
    refetchType: "none",
  });
  await openExternalUrl(authorizationUrl);
};
