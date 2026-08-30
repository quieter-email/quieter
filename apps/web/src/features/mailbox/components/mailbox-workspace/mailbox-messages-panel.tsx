"use client";

import { cn } from "@quieter/ui/cn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";

import { WorkspaceSection } from "#/components/workspace-section";
import { buildComposeDraftFromSavedDraftMessage } from "#/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { MessageList } from "#/features/message-list/components/message-list";
import { MessageDetail } from "#/features/message-thread/components/message-detail";
import { createDemoMailboxActions } from "#/lib/gmail/demo-mail";
import type { MailboxCategory, MessageListItem } from "#/lib/gmail/gmail";
import { createManagedDemoMailboxActions } from "#/lib/managed-mail/demo-managed-mail";
import { orpc } from "#/lib/orpc";

import { createMailboxActionHandlers } from "../mailbox-action-handlers";
import type { MailboxActions } from "../mailbox-action-handlers";
import { useMailboxMessages } from "./use-mailbox-messages";
import { useMailboxPendingActions } from "./use-mailbox-pending-actions";
import {
  useMailboxMessageId,
  useMailboxSearchActions,
  useMailboxThreadId,
} from "./use-mailbox-route-search";

type MailboxMessagesPanelProps = {
  activeMailbox: MailboxCategory;
  currentUserEmail: string | null;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
  onManageTemplates: () => void;
  onOpenSidebar: () => void;
  onSearchQueryChange: (query: string) => void;
  persistComposeDrafts: boolean;
  searchQuery: string;
  signature?: { html: string | null; text: string | null };
};

const noopMailboxAction = async (): Promise<void> => {
  await Promise.resolve();
};

const createReadOnlyMailboxActions = (): MailboxActions =>
  ({
    archiveMessage: noopMailboxAction,
    archiveThread: noopMailboxAction,
    archiveThreads: noopMailboxAction,
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
    unmarkMessageAsSpam: noopMailboxAction,
    unmarkThreadAsSpam: noopMailboxAction,
    unmarkThreadsAsSpam: noopMailboxAction,
    unsubscribeFromMessage: noopMailboxAction,
    untrashMessage: noopMailboxAction,
    untrashThread: noopMailboxAction,
    untrashThreads: noopMailboxAction,
    updateMessageLabels: noopMailboxAction,
    updateThreadLabels: noopMailboxAction,
    updateThreadsLabels: noopMailboxAction,
  }) satisfies MailboxActions;

const resolveMailboxActions = ({
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
  queryClient: ReturnType<typeof useQueryClient>;
  refreshSearchResultsIfNeeded: () => Promise<void>;
  setMessageActionPending: (id: string, pending: boolean) => void;
  setMessageActionsPending: (ids: string[], pending: boolean) => void;
  setThreadActionPending: (id: string, pending: boolean) => void;
  setThreadActionsPending: (ids: string[], pending: boolean) => void;
  unsubscribeFromMessage: (targetMessageId: string) => Promise<void>;
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
    unsubscribeFromMessageMutation: async (targetMessageId) => {
      await unsubscribeFromMessage(targetMessageId);
    },
  });
};

export const MailboxMessagesPanel = ({
  activeMailbox,
  currentUserEmail,
  isDemoMode,
  isManagedDemoMode,
  mailboxId,
  mailboxProvider,
  onComposeDraftRequested,
  onManageTemplates,
  onOpenSidebar,
  onSearchQueryChange,
  persistComposeDrafts,
  searchQuery,
  signature,
}: MailboxMessagesPanelProps) => {
  const messageId = useMailboxMessageId() ?? null;
  const threadId = useMailboxThreadId() ?? null;
  const setMailboxSearch = useMailboxSearchActions();
  const queryClient = useQueryClient();
  const normalizedSearchQuery = searchQuery.trim();
  const isMessageRouteOpen =
    activeMailbox !== "drafts" && (messageId?.trim() ?? "") !== "";
  const [shouldFocusMessageView, setShouldFocusMessageView] = useState(false);
  const {
    isMessageActionPending,
    isThreadActionPending,
    pendingActions,
    setMessageActionsPending,
    setThreadActionsPending,
  } = useMailboxPendingActions();
  const { mutateAsync: unsubscribeFromMessage } = useMutation(
    orpc.mail.unsubscribeFromMessage.mutationOptions()
  );
  const {
    flattenedMessages,
    hasMessagePages,
    isLoadingEmptyMessages,
    listState,
    loadMoreMessages,
    messagesPending,
    refreshMessages,
    refreshSearchResultsIfNeeded,
    selectedMessage,
  } = useMailboxMessages({
    activeMailbox,
    isDemoMode,
    isManagedDemoMode,
    mailboxProvider,
    messageId: messageId ?? undefined,
    queryClient,
    searchQuery: normalizedSearchQuery,
    selectedMailboxId: mailboxId,
    threadId: threadId ?? undefined,
  });

  useLayoutEffect(() => {
    if (
      activeMailbox === "drafts" ||
      (messageId?.trim() ?? "") === "" ||
      messagesPending ||
      !hasMessagePages ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxSearch({ messageId: null, threadId: null });
  }, [
    activeMailbox,
    hasMessagePages,
    messageId,
    messagesPending,
    selectedMessage,
    setMailboxSearch,
  ]);

  const setMessageActionPending = (id: string, pending: boolean) => {
    setMessageActionsPending([id], pending);
  };
  const setThreadActionPending = (id: string, pending: boolean) => {
    setThreadActionsPending([id], pending);
  };
  const mailboxActions = resolveMailboxActions({
    activeMailbox,
    isDemoMode,
    isManagedDemoMode,
    isMessageActionPending,
    isThreadActionPending,
    mailboxId,
    mailboxProvider,
    normalizedSearchQuery,
    queryClient,
    refreshSearchResultsIfNeeded: async () => {
      await refreshSearchResultsIfNeeded();
    },
    setMessageActionPending,
    setMessageActionsPending,
    setThreadActionPending,
    setThreadActionsPending,
    unsubscribeFromMessage: async (targetMessageId) => {
      await unsubscribeFromMessage({ mailboxId, messageId: targetMessageId });
    },
  });

  const openDraft = (message: MessageListItem) => {
    const draftId = message.draftId?.trim() ?? "";
    if (draftId === "") {
      return;
    }

    void setMailboxSearch({ messageId: null });
    onComposeDraftRequested(buildComposeDraftFromSavedDraftMessage(message));
  };

  const activateMessage = (
    nextMessageId: string,
    nextThreadId?: string | null
  ) => {
    if (activeMailbox === "drafts") {
      const draftMessage = flattenedMessages.find(
        (message) => message.id === nextMessageId
      );
      if (draftMessage) {
        openDraft(draftMessage);
      }
      return;
    }

    const shouldPushMobileHistory =
      (messageId?.trim() ?? "") === "" &&
      window.matchMedia("(max-width: 1023.98px)").matches;
    void setMailboxSearch(
      { messageId: nextMessageId, threadId: nextThreadId ?? null },
      { replace: !shouldPushMobileHistory }
    );
  };

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === normalizedSearchQuery) {
      void setMailboxSearch({ messageId: null, threadId: null });
      void refreshMessages();
      return;
    }

    onSearchQueryChange(normalizedQuery);
  };

  const backToList = () => {
    setShouldFocusMessageView(false);
    void setMailboxSearch({ messageId: null, threadId: null });
  };

  const handleRefresh = () => {
    void refreshMessages();
  };

  return (
    <>
      <WorkspaceSection
        className={cn({
          flex: !isMessageRouteOpen,
          hidden: isMessageRouteOpen,
        })}
        layout="cell"
      >
        <MessageList
          activeMailbox={activeMailbox}
          activeMessageId={messageId}
          mailboxId={mailboxId}
          mailboxProvider={mailboxProvider}
          error={listState.error}
          hasNextPage={listState.hasNextPage}
          isError={listState.isError}
          isFetchingNextPage={listState.isFetchingNextPage}
          isPending={listState.isPending}
          isRefreshing={listState.isRefreshing}
          mailboxActions={mailboxActions}
          messages={listState.messages}
          onActivateMessage={activateMessage}
          onDeactivateActiveMessage={backToList}
          onLoadMore={loadMoreMessages}
          onKeyboardOpenMessage={() => {
            setShouldFocusMessageView(true);
          }}
          onOpenDraft={openDraft}
          onOpenSidebar={onOpenSidebar}
          onRefresh={handleRefresh}
          onSearch={applySearch}
          pendingActions={pendingActions}
          searchQuery={normalizedSearchQuery}
        />
      </WorkspaceSection>

      <WorkspaceSection
        className={cn({
          flex: isMessageRouteOpen,
          hidden: !isMessageRouteOpen,
        })}
        layout="cell"
      >
        {isMessageRouteOpen ? (
          <MessageDetail
            activeMailbox={activeMailbox}
            composeDemoMode={isDemoMode}
            composeManagedDemoMode={isManagedDemoMode}
            composePersistDrafts={persistComposeDrafts}
            composeSignature={signature}
            currentUserEmail={currentUserEmail}
            focusOnOpen={shouldFocusMessageView}
            mailboxId={mailboxId}
            mailboxProvider={mailboxProvider}
            mailboxActions={mailboxActions}
            onManageTemplates={onManageTemplates}
            pendingActions={pendingActions}
            isPending={isLoadingEmptyMessages}
            onBackToList={backToList}
            onAutoFocusComplete={() => {
              setShouldFocusMessageView(false);
            }}
            selectedMessage={selectedMessage}
          />
        ) : null}
      </WorkspaceSection>
    </>
  );
};
