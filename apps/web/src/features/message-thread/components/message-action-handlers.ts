import type { MailboxActions } from "~/features/mailbox/components/mailbox-action-handlers";
import type { MessageListItem } from "~/lib/gmail/gmail";

export type LabelChanges = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type ThreadActionHandlers = {
  onDeleteDraft?: (message: MessageListItem) => void | Promise<void>;
  onMarkAsRead?: (threadId: string) => void | Promise<void>;
  onMarkAsSpam?: (threadId: string) => void | Promise<void>;
  onMarkAsUnread?: (threadId: string) => void | Promise<void>;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onUpdateLabels?: (threadId: string, changes: LabelChanges) => void | Promise<void>;
  onMoveToTrash?: (threadId: string) => void | Promise<void>;
  onUntrash?: (threadId: string) => void | Promise<void>;
  onUnmarkAsSpam?: (threadId: string) => void | Promise<void>;
};

export const createMailboxThreadMessageActionHandlers = ({
  mailboxActions,
  onOpenDraft,
}: {
  mailboxActions: MailboxActions;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
}): ThreadActionHandlers => ({
  onDeleteDraft: mailboxActions.deleteDraft,
  onMarkAsRead: (threadId) => mailboxActions.markThreadAsRead(threadId),
  onMarkAsSpam: (threadId) => mailboxActions.markThreadAsSpam(threadId),
  onMarkAsUnread: (threadId) => mailboxActions.markThreadAsUnread(threadId),
  onMoveToTrash: (threadId) => mailboxActions.moveThreadToTrash(threadId),
  onOpenDraft,
  onUnmarkAsSpam: (threadId) => mailboxActions.unmarkThreadAsSpam(threadId),
  onUnsubscribe: mailboxActions.unsubscribeFromMessage,
  onUntrash: (threadId) => mailboxActions.untrashThread(threadId),
  onUpdateLabels: (threadId, changes) => mailboxActions.updateThreadLabels(threadId, changes),
});
