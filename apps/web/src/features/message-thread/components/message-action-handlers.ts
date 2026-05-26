import type { MailboxActions } from "~/features/mailbox/components/mailbox-action-handlers";
import type { MessageListItem } from "~/lib/gmail/gmail";

export type LabelChanges = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type MessageActionsHandlers = {
  onDeleteDraft?: (message: MessageListItem) => void | Promise<void>;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsSpam?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onUpdateLabels?: (messageId: string, changes: LabelChanges) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
  onUntrash?: (messageId: string) => void | Promise<void>;
  onUnmarkAsSpam?: (messageId: string) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
};

export const createMailboxThreadMessageActionHandlers = ({
  mailboxActions,
  onOpenDraft,
  threadId,
}: {
  mailboxActions: MailboxActions;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
  threadId: string;
}): MessageActionsHandlers => ({
  onDeleteDraft: mailboxActions.deleteDraft,
  onDeletePermanently: () => mailboxActions.deleteThreadPermanently(threadId),
  onMarkAsRead: () => mailboxActions.markThreadAsRead(threadId),
  onMarkAsSpam: () => mailboxActions.markThreadAsSpam(threadId),
  onMarkAsUnread: () => mailboxActions.markThreadAsUnread(threadId),
  onMoveToTrash: () => mailboxActions.moveThreadToTrash(threadId),
  onOpenDraft,
  onUnmarkAsSpam: () => mailboxActions.unmarkThreadAsSpam(threadId),
  onUnsubscribe: mailboxActions.unsubscribeFromMessage,
  onUntrash: () => mailboxActions.untrashThread(threadId),
  onUpdateLabels: (_messageId, changes) => mailboxActions.updateThreadLabels(threadId, changes),
});
