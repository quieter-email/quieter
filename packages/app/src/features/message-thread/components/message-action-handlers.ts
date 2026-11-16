import type { MailboxActions } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { toastError } from "@quieter/app/lib/error-toast";
import type { MessageListItem } from "@quieter/app/lib/mail";
import type { MailSnoozeCommand } from "@quieter/mail/snooze";

export type LabelChanges = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type ThreadActionHandlers = {
  onApplySnooze?: (
    threadId: string,
    command: MailSnoozeCommand
  ) => void | Promise<void>;
  placementScope?: MailboxActions["placementScope"];
  onMarkDone?: (threadId: string) => void | Promise<void>;
  onReturnToInbox?: (threadId: string) => void | Promise<void>;
  onSetImportance?: (
    threadId: string,
    important: boolean
  ) => void | Promise<void>;
  onDeleteDraft?: (message: MessageListItem) => void | Promise<void>;
  onMarkAsRead?: (threadId: string) => void | Promise<void>;
  onMarkAsSpam?: (threadId: string) => void | Promise<void>;
  onMarkAsUnread?: (threadId: string) => void | Promise<void>;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
  onUnsubscribe?: (messageId: string) => Promise<boolean>;
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
  onBackToList,
  onOpenDraft,
  supportsFolders = true,
  supportsLabels = true,
  supportsReadState = true,
  supportsUnsubscribe = true,
}: {
  mailboxActions: MailboxActions;
  onBackToList?: () => void;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
  supportsFolders?: boolean;
  supportsLabels?: boolean;
  supportsReadState?: boolean;
  supportsUnsubscribe?: boolean;
}): ThreadActionHandlers => ({
  placementScope: mailboxActions.placementScope,
  ...(mailboxActions.canSetPlacement
    ? {
        onApplySnooze: async (threadId: string, command: MailSnoozeCommand) => {
          try {
            await mailboxActions.applyThreadSnooze(threadId, command);
            if (command.kind === "return-now" || command.kind === "cancel") {
              onBackToList?.();
            }
          } catch (error) {
            toastError(error, { boundary: "mail-snooze" });
          }
        },
        onMarkDone: async (threadId: string) => {
          try {
            await mailboxActions.markThreadDone(threadId);
            onBackToList?.();
          } catch (error) {
            toastError(error, { boundary: "mail-placement" });
          }
        },
        onReturnToInbox: async (threadId: string) => {
          try {
            await mailboxActions.returnThreadToInbox(threadId);
            onBackToList?.();
          } catch (error) {
            toastError(error, { boundary: "mail-placement" });
          }
        },
      }
    : {}),
  ...(mailboxActions.canSetImportance
    ? {
        onSetImportance: async (threadId: string, important: boolean) => {
          try {
            await mailboxActions.setThreadImportance(threadId, important);
          } catch (error) {
            toastError(error, { boundary: "message-importance" });
          }
        },
      }
    : {}),
  ...(supportsReadState && mailboxActions.canMarkRead
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
          onBackToList?.();
        },
        onMoveToTrash: async (threadId: string) => {
          await mailboxActions.moveThreadToTrash(threadId);
          onBackToList?.();
        },
        onOpenDraft,
        onUnmarkAsSpam: async (threadId: string) => {
          await mailboxActions.unmarkThreadAsSpam(threadId);
          onBackToList?.();
        },
        onUntrash: async (threadId: string) => {
          await mailboxActions.untrashThread(threadId);
          onBackToList?.();
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
