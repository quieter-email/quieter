import type { MailboxCategory } from "@quieter/app/lib/mail";

export type ChatViewProps = {
  visible?: boolean;
  activeMailbox: MailboxCategory;
  chatId: string | null;
  draftChatKey: string;
  mailContext?: {
    messageId?: string;
    query?: string;
    threadId?: string;
  };
  mailboxId: string;
  mailboxOrganizationId: string;
  onChatIdChange: (chatId: string) => void;
};
