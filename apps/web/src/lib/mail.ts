import {
  MAIL_UNREAD_LABEL,
  isMessageArchived,
  MAILBOX_LABELS,
} from "@quieter/mail/messages";
import type { MailboxCategory } from "@quieter/mail/messages";

export {
  MAILBOX_LABELS,
  type MailLabelListItem,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageAttachment,
  type MessageInspectorResult,
  type MessageListItem,
  type ThreadMessagesResult,
} from "@quieter/mail/messages";

export const GMAIL_QUERY_STALE_TIME_MS = 1000 * 30;

const normalizeLabelIds = (
  labelIds: string[] | undefined
): string[] | undefined => {
  if (labelIds === undefined || labelIds.length === 0) {
    return undefined;
  }

  const normalized = [
    ...new Set(
      labelIds.flatMap((labelId) => {
        const normalizedLabelId = labelId.trim();
        return normalizedLabelId ? [normalizedLabelId] : [];
      })
    ),
  ];
  return normalized.length > 0 ? normalized : undefined;
};

export const removeUnreadLabel = (
  labelIds: string[] | undefined
): string[] | undefined =>
  normalizeLabelIds(
    labelIds?.filter((labelId) => labelId !== MAIL_UNREAD_LABEL)
  );

export const addUnreadLabel = (
  labelIds: string[] | undefined
): string[] | undefined =>
  normalizeLabelIds([...(labelIds ?? []), MAIL_UNREAD_LABEL]);

export const applyLabelIdChanges = (
  labelIds: readonly string[] | undefined,
  changes: {
    addLabelIds?: readonly string[];
    removeLabelIds?: readonly string[];
  }
): string[] | undefined => {
  const nextLabelIds = new Set(labelIds);

  for (const labelId of changes.removeLabelIds ?? []) {
    nextLabelIds.delete(labelId);
  }

  for (const labelId of changes.addLabelIds ?? []) {
    const normalizedLabelId = labelId.trim();
    if (!normalizedLabelId) {
      continue;
    }
    nextLabelIds.add(normalizedLabelId);
  }

  return normalizeLabelIds([...nextLabelIds]);
};

export const isMessageUnread = (message: {
  isUnread?: boolean;
  labelIds?: string[];
}) =>
  message.isUnread ?? message.labelIds?.includes(MAIL_UNREAD_LABEL) === true;

export const hasRenderableMessageBody = (message: {
  bodyHtml?: string | null;
  bodyText?: string | null;
}) =>
  (message.bodyHtml?.trim() ?? "").length > 0 ||
  (message.bodyText?.trim() ?? "").length > 0;

export const isMessageInMailbox = (
  message: { labelIds?: string[] },
  mailbox: MailboxCategory
) => {
  const { labelIds } = message;
  if (mailbox === "archive") {
    return isMessageArchived(labelIds);
  }
  if (labelIds?.includes(MAILBOX_LABELS[mailbox]) !== true) {
    return false;
  }

  if (mailbox === "trash") {
    return true;
  }

  if (labelIds?.includes(MAILBOX_LABELS.trash)) {
    return false;
  }

  if (mailbox !== "spam" && labelIds?.includes(MAILBOX_LABELS.spam)) {
    return false;
  }

  return true;
};
