"use client";

import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { MessageView } from "@quieter/app/features/message-thread/components/message-view";
import type { MessageViewProps } from "@quieter/app/features/message-thread/components/message-view-types";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

type MessageDetailProps = {
  activeMailbox: MailboxCategory;
  detailOnly?: boolean;
  showDesktopBack?: boolean;
  composeDemoMode?: boolean;
  composeManagedDemoMode?: boolean;
  composePersistDrafts?: boolean;
  composeSenderMailbox?: MessageViewProps["composeSenderMailbox"];
  composeSignature?: { html: string | null; text: string | null };
  focusOnOpen?: boolean;
  currentUserEmail?: string | null;
  isPending?: boolean;
  mailboxActions: MailboxActions;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  onConversationOpened?: MessageViewProps["onConversationOpened"];
  onOpenConversation?: MessageViewProps["onOpenConversation"];
  onBackToList?: () => void;
  onFilterByLabel?: MessageViewProps["onFilterByLabel"];
  onAutoFocusComplete?: () => void;
  onManageSnippets?: () => void;
  pendingActions: MailboxPendingActions;
  selectedMessage: MessageListItem | null;
};

export const MessageDetail = ({
  activeMailbox,
  detailOnly,
  showDesktopBack,
  composeDemoMode,
  composeManagedDemoMode,
  composePersistDrafts,
  composeSenderMailbox,
  composeSignature,
  focusOnOpen,
  currentUserEmail,
  isPending,
  mailboxActions,
  onConversationOpened,
  onOpenConversation,
  onBackToList,
  onFilterByLabel,
  onAutoFocusComplete,
  onManageSnippets,
  pendingActions,
  selectedMessage,
  mailboxId,
  mailboxProvider,
}: MessageDetailProps) => {
  const detailRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (focusOnOpen === true) {
      detailRef.current?.focus({ preventScroll: true });
    }
  }, [focusOnOpen, selectedMessage?.id]);
  const emptyState =
    activeMailbox === "drafts" ? (
      <EmptyMessageState
        description="Choose a draft from the list."
        title="Select a draft"
      />
    ) : (
      <EmptyMessageState />
    );
  let messageContent: ReactNode;
  if (
    isPending === true &&
    (selectedMessage === null || selectedMessage === undefined)
  ) {
    messageContent = (
      <EmptyMessageState description={null} title="Loading conversation…" />
    );
  } else if (selectedMessage !== null && selectedMessage !== undefined) {
    messageContent = (
      <MessageView
        activeMailbox={activeMailbox}
        detailOnly={detailOnly}
        showDesktopBack={showDesktopBack}
        composeDemoMode={composeDemoMode}
        composeManagedDemoMode={composeManagedDemoMode}
        composePersistDrafts={composePersistDrafts}
        composeSenderMailbox={composeSenderMailbox}
        composeSignature={composeSignature}
        focusOnOpen={focusOnOpen}
        currentUserEmail={currentUserEmail}
        mailboxActions={mailboxActions}
        mailboxId={mailboxId}
        mailboxProvider={mailboxProvider}
        message={selectedMessage}
        navigationInteractionRef={detailRef}
        onConversationOpened={onConversationOpened}
        onOpenConversation={onOpenConversation}
        onBackToList={onBackToList}
        onFilterByLabel={onFilterByLabel}
        onAutoFocusComplete={onAutoFocusComplete}
        onManageSnippets={onManageSnippets}
        pendingActions={pendingActions}
      />
    );
  } else {
    messageContent = emptyState;
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      ref={detailRef}
      tabIndex={focusOnOpen === true ? -1 : undefined}
    >
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        key={`${mailboxId}:${selectedMessage?.id ?? (isPending === true ? "loading" : "empty")}`}
      >
        {messageContent}
      </div>
    </section>
  );
};
