import type { MailboxActions } from "~/features/mailbox/components/mailbox-action-handlers";
import type { MessageListItem } from "~/lib/gmail/gmail";

export type LabelChanges = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type ThreadActionHandlers = {
  onArchive?: (threadId: string) => void | Promise<void>;
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
  supportsArchive = true,
  supportsFolders = true,
  supportsLabels = true,
  supportsReadState = true,
  supportsUnsubscribe = true,
}: {
  mailboxActions: MailboxActions;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
  supportsArchive?: boolean;
  supportsFolders?: boolean;
  supportsLabels?: boolean;
  supportsReadState?: boolean;
  supportsUnsubscribe?: boolean;
}): ThreadActionHandlers => ({
  ...(supportsArchive
    ? { onArchive: (threadId: string) => mailboxActions.archiveThread(threadId) }
    : {}),
  ...(supportsReadState
    ? {
        onMarkAsRead: (threadId: string) => mailboxActions.markThreadAsRead(threadId),
        onMarkAsUnread: (threadId: string) => mailboxActions.markThreadAsUnread(threadId),
      }
    : {}),
  ...(supportsUnsubscribe ? { onUnsubscribe: mailboxActions.unsubscribeFromMessage } : {}),
  ...(supportsFolders
    ? {
        onDeleteDraft: mailboxActions.deleteDraft,
        onMarkAsSpam: (threadId: string) => mailboxActions.markThreadAsSpam(threadId),
        onMoveToTrash: (threadId: string) => mailboxActions.moveThreadToTrash(threadId),
        onOpenDraft,
        onUnmarkAsSpam: (threadId: string) => mailboxActions.unmarkThreadAsSpam(threadId),
        onUntrash: (threadId: string) => mailboxActions.untrashThread(threadId),
      }
    : {}),
  ...(supportsLabels
    ? {
        onUpdateLabels: (threadId: string, changes: LabelChanges) =>
          mailboxActions.updateThreadLabels(threadId, changes),
      }
    : {}),
});
