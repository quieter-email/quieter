"use client";

import { cn } from "@quieter/ui/cn";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import { useMailboxMessages } from "~/features/mailbox/components/mailbox-workspace/use-mailbox-messages";
import { useMailboxPendingActions } from "~/features/mailbox/components/mailbox-workspace/use-mailbox-pending-actions";
import { MessageList } from "~/features/message-list/components/message-list";
import { MessageDetail } from "~/features/message-thread/components/message-detail";
import { createDemoMailboxActions, LANDING_DEMO_MAILBOX_ID } from "~/lib/gmail/demo-mail";
import { type MailboxCategory } from "~/lib/gmail/gmail";

type LandingMailboxMessagesPanelProps = {
  activeMailbox: MailboxCategory;
  messageId: string | null;
  onMessageIdChange: (messageId: string | null, threadId: string | null) => void;
  onOpenSidebar: () => void;
  onSearchQueryChange: (query: string) => void;
  searchQuery: string;
  threadId: string | null;
};

export const LandingMailboxMessagesPanel = ({
  activeMailbox,
  messageId,
  onMessageIdChange,
  onOpenSidebar,
  onSearchQueryChange,
  searchQuery,
  threadId,
}: LandingMailboxMessagesPanelProps) => {
  const queryClient = useQueryClient();
  const normalizedSearchQuery = searchQuery.trim();
  const isMessageRouteOpen = activeMailbox !== "drafts" && !!messageId;
  const { pendingActions } = useMailboxPendingActions();
  const {
    handleVisibleMessageIdsChange,
    hasMessagePages,
    isLoadingEmptyMessages,
    listState,
    loadMoreMessages,
    messagesPending,
    refreshMessages,
    selectedMessage,
  } = useMailboxMessages({
    activeMailbox,
    isDemoMode: true,
    isManagedDemoMode: false,
    mailboxProvider: "gmail",
    messageId: messageId ?? undefined,
    threadId: threadId ?? undefined,
    queryClient,
    searchQuery: normalizedSearchQuery,
    selectedMailboxId: LANDING_DEMO_MAILBOX_ID,
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

    onMessageIdChange(null, null);
  }, [
    activeMailbox,
    hasMessagePages,
    messageId,
    messagesPending,
    onMessageIdChange,
    selectedMessage,
  ]);

  const mailboxActions = createDemoMailboxActions(queryClient, LANDING_DEMO_MAILBOX_ID);

  const activateMessage = (nextMessageId: string, nextThreadId?: string | null) => {
    if (activeMailbox === "drafts") {
      return;
    }

    onMessageIdChange(nextMessageId, nextThreadId ?? null);
  };

  const applySearch = (nextQuery: string) => {
    const normalizedQuery = nextQuery.trim();

    if (normalizedQuery === normalizedSearchQuery) {
      onMessageIdChange(null, null);
      void refreshMessages();
      return;
    }

    onSearchQueryChange(normalizedQuery);
    onMessageIdChange(null, null);
  };

  const backToList = () => {
    onMessageIdChange(null, null);
  };

  return (
    <>
      <section
        className={cn(
          "m-2 min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background/60 squircle lg:ml-0 lg:flex",
          {
            "flex flex-1": !isMessageRouteOpen,
            hidden: isMessageRouteOpen,
          },
        )}
      >
        <MessageList
          activeMailbox={activeMailbox}
          activeMessageId={messageId}
          mailboxId={LANDING_DEMO_MAILBOX_ID}
          mailboxProvider="gmail"
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
          onOpenDraft={() => {}}
          onOpenSidebar={onOpenSidebar}
          onRefresh={refreshMessages}
          onSearch={applySearch}
          onVisibleMessageIdsChange={handleVisibleMessageIdsChange}
          pendingActions={pendingActions}
          searchQuery={normalizedSearchQuery}
        />
      </section>

      <div
        className={cn(
          "m-2 min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background/60 squircle lg:ml-0 lg:flex",
          {
            "flex flex-1": isMessageRouteOpen,
            hidden: !isMessageRouteOpen,
          },
        )}
      >
        <MessageDetail
          activeMailbox={activeMailbox}
          currentUserEmail="inbox@quiet-labs.test"
          mailboxActions={mailboxActions}
          mailboxId={LANDING_DEMO_MAILBOX_ID}
          mailboxProvider="gmail"
          onBackToList={backToList}
          pendingActions={pendingActions}
          isPending={isMessageRouteOpen && isLoadingEmptyMessages}
          selectedMessage={selectedMessage}
        />
      </div>
    </>
  );
};
