import type { MailCategory } from "@quieter/mail/data-plane";
import {
  parseStructuredSearchQuery,
  serializeStructuredSearchState,
} from "@quieter/mail/search";

export const normalizeMailQuery = (searchQuery?: string | null) => {
  const normalized = serializeStructuredSearchState(
    parseStructuredSearchQuery(searchQuery?.trim() ?? "")
  );
  return normalized.length > 0 ? normalized : undefined;
};

export const queryKeys = {
  aiSettings: () => ["ai", "settings"] as const,
  chats: (mailboxId: string) => ["mailbox", mailboxId, "chats"] as const,
  gmailUnreadCounts: () => ["gmail-unread-counts"] as const,
  labels: (mailboxId: string) => ["mailbox", mailboxId, "labels"] as const,
  mailboxes: () => ["mailboxes"] as const,
  messages: (
    mailboxId: string,
    mailbox: MailCategory,
    searchQuery?: string | null
  ) =>
    [
      "messages",
      mailboxId,
      mailbox,
      normalizeMailQuery(searchQuery) ?? "",
    ] as const,
  messagesRoot: (mailboxId: string) => ["messages", mailboxId] as const,
  templates: (mailboxId: string) =>
    ["mailbox", mailboxId, "mail-templates"] as const,
  thread: (mailboxId: string, threadId: string) =>
    ["mailbox", mailboxId, "thread", threadId] as const,
  threadRoot: (mailboxId: string) => ["mailbox", mailboxId, "thread"] as const,
};
