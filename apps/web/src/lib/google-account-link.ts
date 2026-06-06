import { rpc } from "~/lib/orpc";

export const openGoogleAccountLink = async (input: {
  mailboxId?: string;
  organizationId?: string | null;
  returnTo: string;
}) => {
  const { authorizationUrl } = await rpc.mail.startGmailConnection({
    mailboxId: input.mailboxId,
    organizationId: input.organizationId,
    returnTo: input.returnTo,
  });
  window.location.assign(authorizationUrl);
};
