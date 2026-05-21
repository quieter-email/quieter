"use client";

import type { ComponentProps } from "react";
import { cn } from "@quieter/ui";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import type { ComposeDraftState } from "~/features/compose";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxSwitcherOrder } from "~/features/navigation/components/mailbox-switcher";
import type { ListMessagesPageResult, MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import { ChatView } from "~/features/chat/components/chat-view";
import { MessageList } from "~/features/message-list/components/message-list";
import { MessageDetail } from "~/features/message-thread/components/message-detail";
import { MailSidebar } from "~/features/navigation/components/mail-sidebar";
import type { MailboxActions, MailboxPendingActions } from "../mailbox-action-handlers";

type MailboxSidebarGroups = ComponentProps<typeof MailSidebar>["groups"];

type MailboxWorkspaceListState = {
  error: unknown;
  hasNextPage: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  isRefreshing: boolean;
  messages: ListMessagesPageResult[];
};

type MailboxWorkspaceLayoutState = {
  isLoadingEmptyMessages: boolean;
  isMessageRouteOpen: boolean;
  isMobileSidebarOpen: boolean;
};

type MailboxWorkspaceContentProps = {
  activeMailbox: MailboxCategory;
  currentUserEmail: string | null;
  defaultMailboxId: string | null;
  layoutState: MailboxWorkspaceLayoutState;
  listState: MailboxWorkspaceListState;
  mailboxActions: MailboxActions;
  mailboxGroups: MailboxSidebarGroups;
  messageId: string | null;
  onActivateMessage: (messageId: string) => void;
  onBackToList: () => void;
  onComposeDraftRequested: (draft: ComposeDraftState) => void;
  onComposeNewMail: () => void;
  onLoadMore: () => void;
  onMobileOpenChange: (open: boolean) => void;
  onOpenDraft: (message: MessageListItem) => void;
  onOpenSidebar: () => void;
  onRefresh: () => void;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onSearch: (query: string) => void;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSelectView: (view: MailboxWorkspaceView) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onVisibleMessageIdsChange: (messageIds: readonly string[]) => void;
  pendingActions: MailboxPendingActions;
  searchQuery: string;
  selectedMailboxId: string | null;
  selectedMessage: MessageListItem | null;
  selectedView: MailboxWorkspaceView;
};

const workspaceContentMotion = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  style: { transformOrigin: "center center" },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

export const MailboxWorkspaceContent = ({
  activeMailbox,
  currentUserEmail,
  defaultMailboxId,
  layoutState,
  listState,
  mailboxActions,
  mailboxGroups,
  messageId,
  onActivateMessage,
  onBackToList,
  onComposeDraftRequested,
  onComposeNewMail,
  onLoadMore,
  onMobileOpenChange,
  onOpenDraft,
  onOpenSidebar,
  onRefresh,
  onReorderMailboxSwitcher,
  onSearch,
  onSelectMailbox,
  onSelectMailboxId,
  onSelectView,
  onSetDefaultMailbox,
  onVisibleMessageIdsChange,
  pendingActions,
  searchQuery,
  selectedMailboxId,
  selectedMessage,
  selectedView,
}: MailboxWorkspaceContentProps) => (
  <LazyMotion features={domAnimation}>
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" />

        <MailSidebar
          defaultMailboxId={defaultMailboxId}
          groups={mailboxGroups}
          onComposeNewMail={onComposeNewMail}
          onMobileOpenChange={onMobileOpenChange}
          onReorderMailboxSwitcher={onReorderMailboxSwitcher}
          onSearch={onSearch}
          onSelectMailbox={onSelectMailbox}
          onSelectMailboxId={onSelectMailboxId}
          onSelectView={onSelectView}
          onSetDefaultMailbox={onSetDefaultMailbox}
          searchQuery={searchQuery}
          selectedMailbox={activeMailbox}
          selectedMailboxId={selectedMailboxId}
          selectedView={selectedView}
          isMobileOpen={layoutState.isMobileSidebarOpen}
        />

        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
          <AnimatePresence initial={false}>
            {selectedView === "chat" ? (
              <m.div
                key="chat"
                className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.08, ease: "linear" }}
              >
                <ChatView
                  activeMailbox={activeMailbox}
                  mailboxId={selectedMailboxId}
                  onOpenSidebar={onOpenSidebar}
                />
              </m.div>
            ) : (
              <m.div
                key="inbox"
                className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background lg:grid lg:grid-cols-[minmax(20rem,34%)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-1 lg:py-1 lg:pr-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.08, ease: "linear" }}
              >
                {selectedMailboxId ? (
                  <>
                    <section
                      className={cn(
                        "min-h-0 min-w-0 flex-col overflow-hidden border border-border/60 bg-background-light lg:flex lg:rounded-lg",
                        {
                          "flex flex-1": !layoutState.isMessageRouteOpen,
                          hidden: layoutState.isMessageRouteOpen,
                        },
                      )}
                    >
                      <MessageList
                        activeMailbox={activeMailbox}
                        activeMessageId={messageId}
                        mailboxId={selectedMailboxId}
                        error={listState.error}
                        hasNextPage={listState.hasNextPage}
                        isError={listState.isError}
                        isFetchingNextPage={listState.isFetchingNextPage}
                        isPending={listState.isPending}
                        isRefreshing={listState.isRefreshing}
                        mailboxActions={mailboxActions}
                        messages={listState.messages}
                        onActivateMessage={onActivateMessage}
                        onDeactivateActiveMessage={onBackToList}
                        onLoadMore={onLoadMore}
                        onOpenDraft={onOpenDraft}
                        onOpenSidebar={onOpenSidebar}
                        onRefresh={onRefresh}
                        onSearch={onSearch}
                        onVisibleMessageIdsChange={onVisibleMessageIdsChange}
                        pendingActions={pendingActions}
                        searchQuery={searchQuery}
                      />
                    </section>

                    <div
                      className={cn(
                        "min-h-0 min-w-0 flex-col overflow-hidden border border-border/60 bg-background-light lg:flex lg:rounded-lg",
                        {
                          "flex flex-1": layoutState.isMessageRouteOpen,
                          hidden: !layoutState.isMessageRouteOpen,
                        },
                      )}
                    >
                      <MessageDetail
                        activeMailbox={activeMailbox}
                        currentUserEmail={currentUserEmail}
                        mailboxId={selectedMailboxId}
                        mailboxActions={mailboxActions}
                        onComposeDraftRequested={onComposeDraftRequested}
                        pendingActions={pendingActions}
                        isPending={
                          layoutState.isMessageRouteOpen && layoutState.isLoadingEmptyMessages
                        }
                        onBackToList={onBackToList}
                        selectedMessage={selectedMessage}
                      />
                    </div>
                  </>
                ) : (
                  <section className="flex min-h-0 flex-1 items-center justify-center bg-background-light px-8">
                    <m.div className="max-w-md space-y-3 text-center" {...workspaceContentMotion}>
                      <h1 className="text-lg font-semibold tracking-tight text-foreground">
                        No mailboxes
                      </h1>
                      <p className="text-sm text-muted-foreground">
                        Connect Gmail or add a managed mailbox to a team.
                      </p>
                    </m.div>
                  </section>
                )}
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  </LazyMotion>
);
