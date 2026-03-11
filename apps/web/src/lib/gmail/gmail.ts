export {
  GMAIL_UNREAD_LABEL,
  MAILBOX_LABELS,
  type GmailLabelListItem,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageListItem,
  type ThreadMessagesResult,
} from "@quietr/trpc/gmail-service";

export const GMAIL_QUERY_STALE_TIME_MS = 1000 * 60 * 2;
export const GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS = 1000 * 10;
export const GMAIL_QUERY_BACKGROUND_SYNC_INTERVAL_MS = 1000 * 60;

export const normalizeLabelIds = (labelIds: string[] | undefined): string[] | undefined => {
  if (!labelIds?.length) return undefined;

  const normalized = Array.from(new Set(labelIds.map((labelId) => labelId.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
};

export const removeUnreadLabel = (labelIds: string[] | undefined): string[] | undefined =>
  normalizeLabelIds(labelIds?.filter((labelId) => labelId !== "UNREAD"));

export const addUnreadLabel = (labelIds: string[] | undefined): string[] | undefined =>
  normalizeLabelIds([...(labelIds ?? []), "UNREAD"]);

export const applyLabelIdChanges = (
  labelIds: readonly string[] | undefined,
  changes: {
    addLabelIds?: readonly string[];
    removeLabelIds?: readonly string[];
  },
): string[] | undefined => {
  const nextLabelIds = new Set(labelIds ?? []);

  for (const labelId of changes.removeLabelIds ?? []) {
    nextLabelIds.delete(labelId);
  }

  for (const labelId of changes.addLabelIds ?? []) {
    const normalizedLabelId = labelId.trim();
    if (!normalizedLabelId) continue;
    nextLabelIds.add(normalizedLabelId);
  }

  return normalizeLabelIds([...nextLabelIds]);
};

export const isMessageUnread = (message: { isUnread?: boolean; labelIds?: string[] }) => {
  return message.isUnread ?? Boolean(message.labelIds?.includes("UNREAD"));
};
