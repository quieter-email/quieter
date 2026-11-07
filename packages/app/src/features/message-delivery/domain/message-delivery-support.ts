import { MAILBOX_LABELS } from "@quieter/app/lib/mail";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";

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
    labelIds.includes(MAILBOX_LABELS.sent) &&
    !labelIds.includes(MAILBOX_LABELS.drafts)
  );
};
