"use client";

import { ORPCError } from "@orpc/client";
import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import type { ComposeSenderMailbox } from "@quieter/app/features/compose/components/compose-workspace";
import { buildComposeDraftFromSavedDraftMessage } from "@quieter/app/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { MailboxIdleState } from "@quieter/app/features/mailbox/components/mailbox-idle-state";
import { useMailboxListController } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-list-controller";
import {
  applyMailboxSearchPatch,
  useMailboxMessageId,
  useMailboxSearchActions,
  useMailboxThreadId,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { useRecordRecentConversation } from "@quieter/app/features/mailbox/components/recent-conversations-provider";
import { MessageList } from "@quieter/app/features/message-list/components/message-list";
import { MessageDetail } from "@quieter/app/features/message-thread/components/message-detail";
import type { MessageViewProps } from "@quieter/app/features/message-thread/components/message-view-types";
import { ReminderDueStrip } from "@quieter/app/features/reminders/reminder-due-strip";
import type { MailLayout } from "@quieter/app/features/settings/domain/mail-layout-setting";
import { toastError } from "@quieter/app/lib/error-toast";
import { buildThreadListEntries } from "@quieter/app/lib/gmail/thread-list";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { useRouter } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

const ScheduledSentRows = lazy(async () => {
  const { ScheduledSentRows: Component } =
    await import("@quieter/app/features/scheduled-send/components/scheduled-sent-rows");
  return { default: Component };
});

type MailboxMessagesPanelProps = {
  detailOnly?: boolean;
  headerAddon?: ReactNode;
  mailLayout: MailLayout;
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
  senderMailbox?: ComposeSenderMailbox;
  signature?: { html: string | null; text: string | null };
};

export const MailboxMessagesPanel = ({
  detailOnly = false,
  headerAddon,
  mailLayout,
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
  senderMailbox,
  signature,
}: MailboxMessagesPanelProps) => {
  const recordOpened = useRecordRecentConversation();
  const onePanelDesktop = mailLayout === "one-panel";
  const messageId = useMailboxMessageId() ?? null;
  const threadId = useMailboxThreadId() ?? null;
  const setMailboxSearch = useMailboxSearchActions();
  const router = useRouter();
  const normalizedSearchQuery = searchQuery.trim();
  const isMessageRouteOpen =
    activeMailbox !== "drafts" && (messageId?.trim() ?? "") !== "";
  const [shouldFocusMessageView, setShouldFocusMessageView] = useState(false);
  const {
    activateListMessage,
    flattenedMessages,
    hasMessagePages,
    listState,
    loadMoreMessages,
    mailboxActions,
    messagesPending,
    pendingActions,
    refreshMessages,
    refreshSelectedThread,
    resetListSelection,
    selectedMessage,
    selectedThreadError,
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

  const threads = useMemo(
    () => buildThreadListEntries(flattenedMessages),
    [flattenedMessages]
  );
  const threadLoadFailed =
    selectedThreadError !== null && selectedMessage === null;
  useEffect(() => {
    if (isMessageRouteOpen && threadLoadFailed) {
      toastError(selectedThreadError, {
        boundary: "selected-conversation",
        fallback: "Could not open conversation. Please try again.",
      });
    }
  }, [isMessageRouteOpen, selectedThreadError, threadLoadFailed]);

  useLayoutEffect(() => {
    if (
      activeMailbox === "drafts" ||
      (messageId?.trim() ?? "") === "" ||
      messagesPending ||
      !hasMessagePages ||
      selectedThreadError !== null ||
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
    selectedThreadError,
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

    const shouldPushHistory =
      (messageId?.trim() ?? "") === "" &&
      (onePanelDesktop || window.matchMedia("(max-width: 1023.98px)").matches);
    activateListMessage(nextMessageId);
    void setMailboxSearch(
      { messageId: nextMessageId, threadId: nextThreadId ?? null },
      { replace: !shouldPushHistory }
    );
  };

  const openConversation: NonNullable<
    MessageViewProps["onOpenConversation"]
  > = async (target, { signal }) => {
    const currentLocation = router.state.location;
    const currentSearch = mailboxSearchSchema.parse(currentLocation.search);
    const patch = {
      calendarConnectionId: null,
      calendarDate: null,
      calendarEventId: null,
      calendarId: null,
      calendarTimeZone: null,
      calendarView: null,
      chatId: target.mailboxId === mailboxId ? undefined : null,
      compose: null,
      mailboxId: target.mailboxId,
      mailto: null,
      messageId: target.messageId,
      query: null,
      reminderId: null,
      threadId: target.threadId,
      workspace: null,
    };
    const expectedSearch = applyMailboxSearchPatch(currentSearch, patch);
    const replace =
      currentSearch.query === "" &&
      currentSearch.mailboxId === target.mailboxId &&
      currentSearch.messageId === target.messageId &&
      currentSearch.threadId === target.threadId;
    await setMailboxSearch(patch, { replace, signal });
    signal.throwIfAborted();
    const settledLocation = router.state.location;
    const settledSearch = mailboxSearchSchema.parse(settledLocation.search);
    const fields = new Set([
      ...Object.keys(expectedSearch),
      ...Object.keys(settledSearch),
    ]);
    if (
      settledLocation.pathname !== currentLocation.pathname ||
      [...fields].some(
        (field) =>
          Reflect.get(expectedSearch, field) !==
          Reflect.get(settledSearch, field)
      )
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "The conversation did not open. Finish your draft or try again.",
      });
    }
    activateListMessage(target.messageId);
    setShouldFocusMessageView(true);
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
    void setMailboxSearch(
      { messageId: null, threadId: null },
      { replace: true }
    );
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
            "lg:hidden": onePanelDesktop && isMessageRouteOpen,
          })}
          layout="cell"
        >
          <MessageList
            headerAddon={headerAddon}
            leadingRows={
              activeMailbox === "sent" &&
              mailboxProvider !== "api" &&
              normalizedSearchQuery === "" ? (
                <Suspense fallback={null}>
                  <ScheduledSentRows
                    sources={[
                      {
                        demo: isDemoMode || isManagedDemoMode,
                        mailboxId,
                      },
                    ]}
                  />
                </Suspense>
              ) : undefined
            }
            listNotices={
              mailboxProvider === "api" ? null : (
                <ReminderDueStrip
                  mailboxId={mailboxId}
                  demo={isDemoMode || isManagedDemoMode}
                />
              )
            }
            wideCompactRows={onePanelDesktop}
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
          "lg:hidden": onePanelDesktop && !isMessageRouteOpen,
        })}
        layout="cell"
      >
        {isMessageRouteOpen && threadLoadFailed ? (
          <EmptyMessageState
            title="Couldn't open conversation"
            description="Try again, or choose another conversation."
            action={
              <ActionFooter>
                <Button onClick={backToList} variant="secondary">
                  Back
                </Button>
                <Button
                  onClick={() => {
                    void refreshSelectedThread();
                  }}
                >
                  Try again
                </Button>
              </ActionFooter>
            }
          />
        ) : null}
        {isMessageRouteOpen && !threadLoadFailed ? (
          <MessageDetail
            onConversationOpened={recordOpened}
            onOpenConversation={openConversation}
            showDesktopBack={onePanelDesktop}
            activeMailbox={activeMailbox}
            detailOnly={detailOnly}
            composeDemoMode={isDemoMode}
            composeManagedDemoMode={isManagedDemoMode}
            composePersistDrafts={persistComposeDrafts}
            composeSenderMailbox={senderMailbox}
            composeSignature={signature}
            currentUserEmail={currentUserEmail}
            focusOnOpen={shouldFocusMessageView || focusOnOpen === true}
            mailboxId={mailboxId}
            mailboxProvider={mailboxProvider}
            mailboxActions={mailboxActions}
            onManageSnippets={onManageSnippets}
            pendingActions={pendingActions}
            isPending={messagesPending}
            onBackToList={backToList}
            onAutoFocusComplete={() => {
              setShouldFocusMessageView(false);
              onFocusRequestComplete?.();
            }}
            selectedMessage={selectedMessage}
          />
        ) : null}
        {!isMessageRouteOpen && activeMailbox !== "drafts" ? (
          <MailboxIdleState
            mailboxIds={[mailboxId]}
            onOpen={(entry) => {
              activateMessage(entry.message.id, entry.message.threadId);
            }}
            threads={threads}
            scope={{ activeMailbox, mailboxId, mailboxProvider }}
          />
        ) : null}
      </WorkspaceSection>
    </>
  );
};
