"use client";

import { ArrowLeft01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { m, useReducedMotion } from "motion/react";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { EmptyMessageState } from "#/components/empty-message-state";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "#/features/mailbox/components/mailbox-action-handlers";
import { appEaseOut, appMotionDuration } from "#/features/motion/app-motion";
import type { MailboxCategory, MessageListItem } from "#/lib/gmail/gmail";

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

const MessageDetailLoadingSkeleton = () => (
  <div
    aria-live="polite"
    className="mx-auto block w-full max-w-3xl space-y-6 px-4 py-6"
  >
    <span className="sr-only">Loading message…</span>
    <div aria-hidden="true" className="animate-pulse space-y-8">
      <div className="space-y-2">
        <div className="h-5 w-2/3 rounded-md bg-muted/80" />
        <div className="h-3.5 w-44 rounded-md bg-muted/70" />
      </div>

      <div className="flex items-center gap-3 border-t pt-8">
        <div className="size-10 rounded-lg bg-muted/80" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-40 rounded-md bg-muted/80" />
          <div className="h-3 w-56 rounded-md bg-muted/70" />
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <div className="h-3.5 w-full rounded-md bg-muted/70" />
        <div className="h-3.5 w-11/12 rounded-md bg-muted/70" />
        <div className="h-3.5 w-5/6 rounded-md bg-muted/70" />
        <div className="h-3.5 w-2/3 rounded-md bg-muted/70" />
      </div>
    </div>
  </div>
);

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
          <div className="grid h-full place-items-center text-sm text-muted-fg">
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
        <div className="flex min-h-12 shrink-0 items-center border-b px-2 lg:hidden">
          <IconButtonTooltip label="Back to list">
            <Button
              aria-label="Back to list"
              onClick={onBackToList}
              size="icon-lg"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} />
            </Button>
          </IconButtonTooltip>
        </div>
      )}

      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        data-message-detail-scroll-container
      >
        <m.div
          animate={{
            filter: "blur(0px)",
            opacity: 1,
            transform: "translate3d(0, 0, 0)",
          }}
          className="flex min-h-full flex-1 flex-col"
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
