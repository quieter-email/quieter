"use client";

import { cn } from "@quieter/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import { type ComposeDraftState, buildComposeDraftFromSavedDraftMessage } from "~/features/compose";
import { MessageList } from "~/features/message-list/components/message-list";
import { MessageDetail } from "~/features/message-thread/components/message-detail";
import { createDemoMailboxActions } from "~/lib/gmail/demo-mail";
import { type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import { orpc } from "~/lib/orpc";
import { createMailboxActionHandlers } from "../mailbox-action-handlers";
import { useMailboxMessages } from "./use-mailbox-messages";
import { useMailboxPendingActions } from "./use-mailbox-pending-actions";
import { useMailboxMessageId, useMailboxSearchActions } from "./use-mailbox-route-search";

type MailboxMessagesPanelProps = {
  activeMailbox: MailboxCategory;
  currentUserEmail: string | null;
  isDemoMode: boolean;
  mailboxId: string;
  mailboxProvider: "gmail" | "managed";
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
  onOpenSidebar: () => void;
  onSearchQueryChange: (query: string) => void;
  searchQuery: string;
};

export const MailboxMessagesPanel = ({
  activeMailbox,
  currentUserEmail,
  isDemoMode,
  mailboxId,
  mailboxProvider,
  onComposeDraftRequested,
  onOpenSidebar,
  onSearchQueryChange,
  searchQuery,
}: MailboxMessagesPanelProps) => {
  const messageId = useMailboxMessageId() ?? null;
  const setMailboxSearch = useMailboxSearchActions();
  const queryClient = useQueryClient();
  const normalizedSearchQuery = searchQuery.trim();
  const isMessageRouteOpen = activeMailbox !== "drafts" && !!messageId;
  const {
    isMessageActionPending,
    isThreadActionPending,
    pendingActions,
    setMessageActionsPending,
    setThreadActionsPending,
  } = useMailboxPendingActions();
  const { mutateAsync: unsubscribeFromMessage } = useMutation(
    orpc.mail.unsubscribeFromMessage.mutationOptions(),
  );
  const {
    flattenedMessages,
    handleVisibleMessageIdsChange,
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
    mailboxProvider,
    messageId: messageId ?? undefined,
    queryClient,
    searchQuery: normalizedSearchQuery,
    selectedMailboxId: mailboxId,
  });

  useLayoutEffect(() => {
    if (
      activeMailbox === "drafts" ||
      !messageId ||
      messagesPending ||
      !hasMessagePages ||
      selectedMessage
    ) {
      return;
    }

    void setMailboxSearch({ messageId: null });
  }, [
    activeMailbox,
    hasMessagePages,
    messageId,
    messagesPending,
    selectedMessage,
    setMailboxSearch,
  ]);

  const setMessageActionPending = (id: string, pending: boolean) =>
    setMessageActionsPending([id], pending);
  const setThreadActionPending = (id: string, pending: boolean) =>
    setThreadActionsPending([id], pending);
  const mailboxActions = isDemoMode
    ? createDemoMailboxActions(queryClient)
    : createMailboxActionHandlers({
        activeMailbox,
        activeSearchQuery: normalizedSearchQuery,
        queryClient,
        refreshSearchResultsIfNeeded,
        isMessageActionPending,
        isThreadActionPending,
        setMessageActionPending,
        setMessageActionsPending,
        setThreadActionPending,
        setThreadActionsPending,
        unsubscribeFromMessageMutation: async (messageId) => {
          await unsubscribeFromMessage({ mailboxId, messageId });
        },
        mailboxId,
      });

  const openDraft = (message: MessageListItem) => {
    if (!message.draftId) {
      return;
    }

    void setMailboxSearch({ messageId: null });
    onComposeDraftRequested(buildComposeDraftFromSavedDraftMessage(message));
  };

  const activateMessage = (nextMessageId: string) => {
    if (activeMailbox === "drafts") {
      const draftMessage = flattenedMessages.find((message) => message.id === nextMessageId);
      if (draftMessage) {
        openDraft(draftMessage);
      }
      return;
    }

    const shouldPushMobileHistory =
      !messageId && window.matchMedia("(max-width: 1023.98px)").matches;
    void setMailboxSearch({ messageId: nextMessageId }, { replace: !shouldPushMobileHistory });
  };

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === normalizedSearchQuery) {
      void setMailboxSearch({ messageId: null });
      void refreshMessages();
      return;
    }

    onSearchQueryChange(normalizedQuery);
  };

  const backToList = () => {
    void setMailboxSearch({ messageId: null });
  };

  return (
    <>
      <section
        className={cn("min-h-0 min-w-0 flex-col overflow-hidden border lg:flex", {
          "flex flex-1": !isMessageRouteOpen,
          hidden: isMessageRouteOpen,
        })}
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
          onOpenDraft={openDraft}
          onOpenSidebar={onOpenSidebar}
          onRefresh={refreshMessages}
          onSearch={applySearch}
          onVisibleMessageIdsChange={handleVisibleMessageIdsChange}
          pendingActions={pendingActions}
          searchQuery={normalizedSearchQuery}
        />
      </section>

      <div
        className={cn("min-h-0 min-w-0 flex-col overflow-hidden lg:flex", {
          "flex flex-1": isMessageRouteOpen,
          hidden: !isMessageRouteOpen,
        })}
      >
        <MessageDetail
          activeMailbox={activeMailbox}
          currentUserEmail={currentUserEmail}
          mailboxId={mailboxId}
          mailboxProvider={mailboxProvider}
          mailboxActions={mailboxActions}
          onComposeDraftRequested={onComposeDraftRequested}
          pendingActions={pendingActions}
          isPending={isMessageRouteOpen && isLoadingEmptyMessages}
          onBackToList={backToList}
          selectedMessage={selectedMessage}
        />
      </div>
    </>
  );
};
