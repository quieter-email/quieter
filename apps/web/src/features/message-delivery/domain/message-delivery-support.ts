import { MAILBOX_LABELS } from "#/lib/gmail/gmail";
import type { MessageListItem } from "#/lib/gmail/gmail";
import { isSandboxMailboxId } from "#/lib/sandbox-mailbox";

/**
 * Only outbound mail sent through this team reports delivery feedback. Gmail
 * mailboxes and demo mailboxes never do.
 */
export const supportsMessageDelivery = ({
  mailboxId,
  mailboxProvider,
  message,
}: {
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  message: MessageListItem;
}) => {
  if (mailboxId === "" || isSandboxMailboxId(mailboxId)) {
    return false;
  }
  if (mailboxProvider === "api") {
    return true;
  }
  const labelIds = message.labelIds ?? [];
  return (
    mailboxProvider === "managed" &&
    labelIds.includes(MAILBOX_LABELS.sent) &&
    !labelIds.includes(MAILBOX_LABELS.drafts)
  );
};
