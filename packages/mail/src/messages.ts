import type { ComposeDraftAnchor } from "./compose/schema";

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
  draftVersion?: string;
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
