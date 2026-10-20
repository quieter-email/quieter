"use client";

import { buildComposeDraftFromSavedDraftMessage } from "@quieter/app/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { useMailboxListController } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-list-controller";
import {
  useMailboxMessageId,
  useMailboxSearchActions,
  useMailboxThreadId,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { MessageList } from "@quieter/app/features/message-list/components/message-list";
import { MessageDetail } from "@quieter/app/features/message-thread/components/message-detail";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import { cn } from "@quieter/ui/cn";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { useLayoutEffect, useState } from "react";

type MailboxMessagesPanelProps = {
  detailOnly?: boolean;
  activeMailbox: MailboxCategory;
  currentUserEmail: string | null;
  focusOnOpen?: boolean;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
  onFocusRequestComplete?: () => void;
  onManageSnippets: () => void;
  onOpenSidebar: () => void;
  onSearchQueryChange: (query: string) => void;
  persistComposeDrafts: boolean;
  searchQuery: string;
  signature?: { html: string | null; text: string | null };
};

export const MailboxMessagesPanel = ({
  detailOnly = false,
  activeMailbox,
  currentUserEmail,
  focusOnOpen,
  isDemoMode,
  isManagedDemoMode,
  mailboxId,
  mailboxProvider,
  onComposeDraftRequested,
  onFocusRequestComplete,
  onManageSnippets,
  onOpenSidebar,
  onSearchQueryChange,
  persistComposeDrafts,
  searchQuery,
  signature,
}: MailboxMessagesPanelProps) => {
  const messageId = useMailboxMessageId() ?? null;
  const threadId = useMailboxThreadId() ?? null;
  const setMailboxSearch = useMailboxSearchActions();
  const normalizedSearchQuery = searchQuery.trim();
  const isMessageRouteOpen =
    activeMailbox !== "drafts" && (messageId?.trim() ?? "") !== "";
  const [shouldFocusMessageView, setShouldFocusMessageView] = useState(false);
  const {
    activateListMessage,
    flattenedMessages,
    hasMessagePages,
    isLoadingEmptyMessages,
    listState,
    loadMoreMessages,
    mailboxActions,
    messagesPending,
    pendingActions,
    refreshMessages,
    resetListSelection,
    selectedMessage,
  } = useMailboxListController({
    activeMailbox,
    isDemoMode,
    isManagedDemoMode,
    mailboxId,
    mailboxProvider,
    messageId,
    searchQuery: normalizedSearchQuery,
    threadId,
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
    activateListMessage(nextMessageId);
    void setMailboxSearch(
      { messageId: nextMessageId, threadId: nextThreadId ?? null },
      { replace: !shouldPushMobileHistory }
    );
  };

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === normalizedSearchQuery) {
      resetListSelection();
      void setMailboxSearch({ messageId: null, threadId: null });
      void refreshMessages();
      return;
    }

    onSearchQueryChange(normalizedQuery);
  };

  const backToList = () => {
    setShouldFocusMessageView(false);
    onFocusRequestComplete?.();
    void setMailboxSearch({ messageId: null, threadId: null });
  };

  const handleRefresh = () => {
    void refreshMessages();
  };

  return (
    <>
      {!detailOnly && (
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
      )}

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
            focusOnOpen={shouldFocusMessageView || focusOnOpen === true}
            mailboxId={mailboxId}
            mailboxProvider={mailboxProvider}
            mailboxActions={mailboxActions}
            onManageSnippets={onManageSnippets}
            pendingActions={pendingActions}
            isPending={isLoadingEmptyMessages}
            onBackToList={backToList}
            onAutoFocusComplete={() => {
              setShouldFocusMessageView(false);
              onFocusRequestComplete?.();
            }}
            selectedMessage={selectedMessage}
          />
        ) : null}
      </WorkspaceSection>
    </>
  );
};
