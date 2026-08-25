"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { m, useReducedMotion } from "motion/react";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { EmptyMessageState } from "#/components/empty-message-state";
import { MobileHeader } from "#/components/mobile-header";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "#/features/mailbox/components/mailbox-action-handlers";
import { appEaseOut, appMotionDuration } from "#/features/motion/app-motion";
import type { MailboxCategory, MessageListItem } from "#/lib/gmail/gmail";

import { MessageDetailLoadingSkeleton } from "./message-detail-loading";
import { MessageView } from "./message-view";

type MessageDetailProps = {
  activeMailbox: MailboxCategory;
  focusOnOpen?: boolean;
  currentUserEmail?: string | null;
  isPending?: boolean;
  mailboxActions: MailboxActions;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  onBackToList?: () => void;
  onAutoFocusComplete?: () => void;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  pendingActions: MailboxPendingActions;
  selectedMessage: MessageListItem | null;
};

export const MessageDetail = ({
  activeMailbox,
  focusOnOpen,
  currentUserEmail,
  isPending,
  mailboxActions,
  onBackToList,
  onAutoFocusComplete,
  onComposeDraftRequested,
  pendingActions,
  selectedMessage,
  mailboxId,
  mailboxProvider,
}: MessageDetailProps) => {
  const reducedMotion = useReducedMotion();
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
            <HugeiconsIcon
              className="animate-spin text-muted-fg"
              icon={Loading03Icon}
            />
          </div>
        }
      >
        <MessageView
          activeMailbox={activeMailbox}
          focusOnOpen={focusOnOpen}
          currentUserEmail={currentUserEmail}
          mailboxActions={mailboxActions}
          mailboxId={mailboxId}
          mailboxProvider={mailboxProvider}
          message={selectedMessage}
          onBackToList={onBackToList}
          onAutoFocusComplete={onAutoFocusComplete}
          onComposeDraftRequested={onComposeDraftRequested}
          pendingActions={pendingActions}
        />
      </Suspense>
    );
  } else {
    messageContent = emptyState;
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {onBackToList && (
        <MobileHeader leading="back" onLeadingClick={onBackToList} />
      )}

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
          key={
            selectedMessage?.id ?? (isPending === true ? "loading" : "empty")
          }
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
