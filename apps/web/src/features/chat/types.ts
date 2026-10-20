import type { MailboxCategory } from "#/lib/mail";

export type ChatViewProps = {
  docked: boolean;
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
