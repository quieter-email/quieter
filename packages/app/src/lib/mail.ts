export {
  MAILBOX_LABELS,
  addUnreadLabel,
  applyLabelIdChanges,
  hasRenderableMessageBody,
  isMessageArchived,
  isMessageInMailbox,
  isMessageUnread,
  removeUnreadLabel,
  type MailLabelListItem,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageAttachment,
  type MessageInspectorResult,
  type MessageListItem,
  type ThreadMessagesResult,
} from "@quieter/mail/messages";

export const GMAIL_QUERY_STALE_TIME_MS = 1000 * 30;
export const GMAIL_QUERY_FOREGROUND_SYNC_INTERVAL_MS = 1000 * 60;
