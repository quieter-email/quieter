import type { UIMessage } from "@tanstack/ai";
import type { MailboxCategory } from "~/lib/gmail/gmail";

export type ChatViewProps = {
  activeMailbox: MailboxCategory;
  chatId: string | null;
  draftChatKey: string;
  mailboxId: string | null;
  onChatIdChange: (chatId: string, pendingPrompt: string) => void;
  onOpenSidebar: () => void;
  onPendingPromptSent: () => void;
  pendingPrompt: string | null;
};

export type ChatTurn = {
  assistant: UIMessage | null;
  id: string;
  user: UIMessage | null;
};

export type GmailSearchToolResult = {
  category?: string;
  error?: string;
  messages?: Array<{
    date?: string;
    from?: string;
    id?: string;
    isUnread?: boolean;
    labelIds?: string[];
    snippet?: string;
    subject?: string;
    threadId?: string;
  }>;
  query?: string;
  resultSizeEstimate?: number;
};
