import { createMailboxActionHandlers } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import type { MailboxActions } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { createDemoMailboxActions } from "@quieter/app/lib/gmail/demo-mail";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { createManagedDemoMailboxActions } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import type { QueryClient } from "@tanstack/react-query";

const noopMailboxAction = async (): Promise<void> => {
  await Promise.resolve();
};

const createReadOnlyMailboxActions = (): MailboxActions =>
  ({
    archiveMessage: noopMailboxAction,
    archiveThread: noopMailboxAction,
    archiveThreads: noopMailboxAction,
    canSetImportance: false,
    deleteDraft: noopMailboxAction,
    deleteDrafts: noopMailboxAction,
    markMessageAsRead: noopMailboxAction,
    markMessageAsSpam: noopMailboxAction,
    markMessageAsUnread: noopMailboxAction,
    markThreadAsRead: noopMailboxAction,
    markThreadAsSpam: noopMailboxAction,
    markThreadAsUnread: noopMailboxAction,
    markThreadsAsRead: noopMailboxAction,
    markThreadsAsSpam: noopMailboxAction,
    markThreadsAsUnread: noopMailboxAction,
    moveMessageToTrash: noopMailboxAction,
    moveThreadToTrash: noopMailboxAction,
    moveThreadsToTrash: noopMailboxAction,
    setThreadImportance: noopMailboxAction,
    setThreadsImportance: noopMailboxAction,
    unmarkMessageAsSpam: noopMailboxAction,
    unmarkThreadAsSpam: noopMailboxAction,
    unmarkThreadsAsSpam: noopMailboxAction,
    unsubscribeFromMessage: async () => {
      await Promise.resolve();
      return false;
    },
    untrashMessage: noopMailboxAction,
    untrashThread: noopMailboxAction,
    untrashThreads: noopMailboxAction,
    updateMessageLabels: noopMailboxAction,
    updateThreadLabels: noopMailboxAction,
    updateThreadsLabels: noopMailboxAction,
  }) satisfies MailboxActions;

export const resolveMailboxActions = ({
  activeMailbox,
  isDemoMode,
  isManagedDemoMode,
  isMessageActionPending,
  isThreadActionPending,
  mailboxId,
  mailboxProvider,
  normalizedSearchQuery,
  queryClient,
  refreshSearchResultsIfNeeded,
  setMessageActionPending,
  setMessageActionsPending,
  setThreadActionPending,
  setThreadActionsPending,
  unsubscribeFromMessage,
}: {
  activeMailbox: MailboxCategory;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  isMessageActionPending: (messageId: string | null | undefined) => boolean;
  isThreadActionPending: (threadId: string | null | undefined) => boolean;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  normalizedSearchQuery: string;
  queryClient: QueryClient;
  refreshSearchResultsIfNeeded: () => Promise<void>;
  setMessageActionPending: (id: string, pending: boolean) => void;
  setMessageActionsPending: (ids: string[], pending: boolean) => void;
  setThreadActionPending: (id: string, pending: boolean) => void;
  setThreadActionsPending: (ids: string[], pending: boolean) => void;
  unsubscribeFromMessage: (targetMessageId: string) => Promise<boolean>;
}): MailboxActions => {
  if (mailboxProvider === "api") {
    return createReadOnlyMailboxActions();
  }

  if (isManagedDemoMode) {
    return createManagedDemoMailboxActions(queryClient);
  }

  if (isDemoMode) {
    return createDemoMailboxActions(queryClient);
  }

  return createMailboxActionHandlers({
    activeMailbox,
    activeSearchQuery: normalizedSearchQuery,
    isMessageActionPending,
    isThreadActionPending,
    mailboxId,
    queryClient,
    refreshSearchResultsIfNeeded,
    setMessageActionPending,
    setMessageActionsPending,
    setThreadActionPending,
    setThreadActionsPending,
    unsubscribeFromMessageMutation: unsubscribeFromMessage,
  });
};
