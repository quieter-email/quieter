"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { MessageDetailLoadingSkeleton } from "@quieter/app/features/message-thread/components/message-detail-loading";
import { MessageView } from "@quieter/app/features/message-thread/components/message-view";
import type { MessageViewProps } from "@quieter/app/features/message-thread/components/message-view-types";
import {
  appEaseOut,
  appMotionDuration,
} from "@quieter/app/features/motion/app-motion";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import { Icon } from "@quieter/ui/icon";
import { m, useReducedMotion } from "motion/react";
import { Suspense, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

type MessageDetailProps = {
  activeMailbox: MailboxCategory;
  detailOnly?: boolean;
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
  onBackToList?: () => void;
  onAutoFocusComplete?: () => void;
  onManageSnippets?: () => void;
  pendingActions: MailboxPendingActions;
  selectedMessage: MessageListItem | null;
};

export const MessageDetail = ({
  activeMailbox,
  detailOnly,
  composeDemoMode,
  composeManagedDemoMode,
  composePersistDrafts,
  composeSenderMailbox,
  composeSignature,
  focusOnOpen,
  currentUserEmail,
  isPending,
  mailboxActions,
  onBackToList,
  onAutoFocusComplete,
  onManageSnippets,
  pendingActions,
  selectedMessage,
  mailboxId,
  mailboxProvider,
}: MessageDetailProps) => {
  const reducedMotion = useReducedMotion();
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
    messageContent = <MessageDetailLoadingSkeleton />;
  } else if (selectedMessage !== null && selectedMessage !== undefined) {
    messageContent = (
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-body text-muted-fg">
            <Icon animation="spin" tone="muted" icon={Loading03Icon} />
          </div>
        }
      >
        <MessageView
          activeMailbox={activeMailbox}
          detailOnly={detailOnly}
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
          onBackToList={onBackToList}
          onAutoFocusComplete={onAutoFocusComplete}
          onManageSnippets={onManageSnippets}
          pendingActions={pendingActions}
        />
      </Suspense>
    );
  } else {
    messageContent = emptyState;
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      ref={detailRef}
      tabIndex={focusOnOpen === true ? -1 : undefined}
    >
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        data-message-detail-scroll-container
      >
        <m.div
          animate={{
            filter: "blur(0px)",
            opacity: 1,
            transform: "translate3d(0, 0, 0)",
          }}
          className="flex min-h-full min-w-0 flex-1 flex-col"
          initial={
            reducedMotion === true
              ? { opacity: 0 }
              : {
                  filter: "blur(4px)",
                  opacity: 0.55,
                  transform: "translate3d(8px, 0, 0)",
                }
          }
          key={`${mailboxId}:${selectedMessage?.id ?? (isPending === true ? "loading" : "empty")}`}
          transition={{
            duration:
              reducedMotion === true
                ? appMotionDuration.feedback
                : appMotionDuration.layout,
            ease: appEaseOut,
          }}
        >
          {messageContent}
        </m.div>
      </div>
    </section>
  );
};
