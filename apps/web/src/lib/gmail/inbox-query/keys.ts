import { parseStructuredSearchQuery, serializeStructuredSearchState } from "@quieter/mail/search";
import type { MailboxCategory } from "../gmail";

export const normalizeSearchQuery = (searchQuery: string | null | undefined) => {
  const normalized = serializeStructuredSearchState(
    parseStructuredSearchQuery(searchQuery?.trim() ?? ""),
  );
  return normalized && normalized.length > 0 ? normalized : undefined;
};

export const getMessagesQueryKey = (
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
) => ["messages", mailboxId, mailbox, normalizeSearchQuery(searchQuery) ?? ""] as const;

export const getLiveSyncQueryKey = (
  mailboxId: string,
  mailbox: MailboxCategory,
  searchQuery?: string | null,
) => [...getMessagesQueryKey(mailboxId, mailbox, searchQuery), "live-sync"] as const;

export const parsePageToken = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};
