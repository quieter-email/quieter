import type { ComposeDraftAnchor } from "./compose/schema";
import type { MailCategory } from "./data-plane";

export type { MailCategory as MailboxCategory } from "./data-plane";

export const MAILBOX_LABELS = {
  archive: "ARCHIVE",
  drafts: "DRAFT",
  inbox: "INBOX",
  sent: "SENT",
  spam: "SPAM",
  trash: "TRASH",
  unread: "UNREAD",
} as const;

export const MAIL_UNREAD_LABEL = MAILBOX_LABELS.unread;

export type MessageHeader = { name: string; value: string };

export type MessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: MessagePart[];
};

export type MessageListItem = {
  id: string;
  threadId: string;
  threadLabelIds?: string[];
  threadMessageCount?: number;
  threadAttachmentCount?: number;
  draftId?: string;
  draftAnchor?: ComposeDraftAnchor;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  replyTo?: string;
  messageHeaderId?: string;
  references?: string;
  date?: string;
  internalDate?: string;
  bodyHtml?: string;
  bodyText?: string;
  attachments?: MessageAttachment[];
  apiSource?: {
    canCreateMailbox: boolean;
    canManageMailbox: boolean;
    includedInMailbox: boolean;
    organizationId: string;
    senderAddress: string;
    senderMailboxId: string | null;
  };
  unsubscribeMailto?: string;
  unsubscribeUrl?: string;
  senderAvatarUrls?: { light: string; dark: string };
  labelIds?: string[];
  isUnread?: boolean;
};

export type MessageAttachment = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type MessageInspectorResult = {
  id: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  messageHeaderId?: string;
  references?: string;
  date?: string;
  internalDate?: string;
  headers: MessageHeader[];
  payload?: MessagePart;
  raw?: string;
  rawText?: string;
};

export type ListMessagesPageResult = {
  messages: MessageListItem[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
  historyId?: string;
};

export type ThreadMessagesResult = {
  threadId: string;
  snippet?: string;
  subject?: string;
  messages: MessageListItem[];
};

export type MailLabelListItem = { id: string; name: string; type?: string };

export type MailboxSyncDelta = {
  historyId?: string;
  hasChanges: boolean;
  refreshFirstPage: boolean;
  removedMessageIds: string[];
  requiresFullRefresh: boolean;
  updatedMessages: MessageListItem[];
};

export const isMessageArchived = (
  labelIds: readonly string[] | undefined
): boolean =>
  labelIds !== undefined &&
  labelIds.length > 0 &&
  ![
    MAILBOX_LABELS.inbox,
    MAILBOX_LABELS.sent,
    MAILBOX_LABELS.drafts,
    MAILBOX_LABELS.spam,
    MAILBOX_LABELS.trash,
  ].some((labelId) => labelIds.includes(labelId));

const normalizeLabelIds = (
  labelIds: readonly string[] | undefined
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
  labelIds: readonly string[] | undefined
): string[] | undefined =>
  normalizeLabelIds(
    labelIds?.filter((labelId) => labelId !== MAIL_UNREAD_LABEL)
  );

export const addUnreadLabel = (
  labelIds: readonly string[] | undefined
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
}): boolean =>
  message.isUnread ?? message.labelIds?.includes(MAIL_UNREAD_LABEL) === true;

export const hasRenderableMessageBody = (message: {
  bodyHtml?: string | null;
  bodyText?: string | null;
}): boolean =>
  (message.bodyHtml?.trim() ?? "").length > 0 ||
  (message.bodyText?.trim() ?? "").length > 0;

export const isMessageInMailbox = (
  message: { labelIds?: string[] },
  mailbox: MailCategory
): boolean => {
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
