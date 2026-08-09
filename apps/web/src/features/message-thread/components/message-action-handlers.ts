import type { MailboxActions } from "#/features/mailbox/components/mailbox-action-handlers";
import type { MessageListItem } from "#/lib/gmail/gmail";

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
  onUpdateLabels?: (
    threadId: string,
    changes: LabelChanges
  ) => void | Promise<void>;
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
    ? {
        onArchive: async (threadId: string) => {
          await mailboxActions.archiveThread(threadId);
        },
      }
    : {}),
  ...(supportsReadState
    ? {
        onMarkAsRead: async (threadId: string) => {
          await mailboxActions.markThreadAsRead(threadId);
        },
        onMarkAsUnread: async (threadId: string) => {
          await mailboxActions.markThreadAsUnread(threadId);
        },
      }
    : {}),
  ...(supportsUnsubscribe
    ? { onUnsubscribe: mailboxActions.unsubscribeFromMessage }
    : {}),
  ...(supportsFolders
    ? {
        onDeleteDraft: mailboxActions.deleteDraft,
        onMarkAsSpam: async (threadId: string) => {
          await mailboxActions.markThreadAsSpam(threadId);
        },
        onMoveToTrash: async (threadId: string) => {
          await mailboxActions.moveThreadToTrash(threadId);
        },
        onOpenDraft,
        onUnmarkAsSpam: async (threadId: string) => {
          await mailboxActions.unmarkThreadAsSpam(threadId);
        },
        onUntrash: async (threadId: string) => {
          await mailboxActions.untrashThread(threadId);
        },
      }
    : {}),
  ...(supportsLabels
    ? {
        onUpdateLabels: async (threadId: string, changes: LabelChanges) => {
          await mailboxActions.updateThreadLabels(threadId, changes);
        },
      }
    : {}),
});
