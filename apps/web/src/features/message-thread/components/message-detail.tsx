"use client";

import { ArrowLeft01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, IconButtonTooltip } from "@quieter/ui";
import { m } from "motion/react";
import { Suspense } from "react";
import type { ComposeDraftState } from "~/features/compose";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "~/features/mailbox/components/mailbox-action-handlers";
import type { MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import { EmptyMessageState } from "~/components/empty-message-state";
import { MessageView } from "./message-view";

type MessageDetailProps = {
  activeMailbox: MailboxCategory;
  currentUserEmail?: string | null;
  isPending?: boolean;
  mailboxActions: MailboxActions;
  mailboxId: string;
  mailboxProvider: "gmail" | "managed";
  onBackToList?: () => void;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  pendingActions: MailboxPendingActions;
  selectedMessage: MessageListItem | null;
};

const messageDetailContentMotion = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  style: { transformOrigin: "center center" },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

const MessageDetailLoadingSkeleton = () => (
  // react-doctor-disable-next-line react-doctor/prefer-tag-over-role
  <div aria-live="polite" className="mx-auto block w-full max-w-3xl space-y-6 py-6" role="status">
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
  currentUserEmail,
  isPending,
  mailboxActions,
  onBackToList,
  onComposeDraftRequested,
  pendingActions,
  selectedMessage,
  mailboxId,
  mailboxProvider,
}: MessageDetailProps) => {
  const emptyState =
    activeMailbox === "drafts" ? (
      <EmptyMessageState description="Choose a draft from the list." title="Select a draft" />
    ) : (
      <EmptyMessageState />
    );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {onBackToList && (
        <div className="flex h-12 shrink-0 items-center border-b px-3 lg:hidden">
          <IconButtonTooltip label="Back to list">
            <Button
              aria-label="Back to list"
              onClick={onBackToList}
              size="icon-sm"
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
        <m.div className="flex min-h-full flex-1 flex-col" {...messageDetailContentMotion}>
          {isPending && !selectedMessage ? (
            <MessageDetailLoadingSkeleton />
          ) : selectedMessage ? (
            <Suspense
              fallback={
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  <HugeiconsIcon
                    className="animate-spin text-muted-foreground"
                    icon={Loading03Icon}
                  />
                </div>
              }
            >
              <MessageView
                activeMailbox={activeMailbox}
                currentUserEmail={currentUserEmail}
                mailboxActions={mailboxActions}
                mailboxId={mailboxId}
                mailboxProvider={mailboxProvider}
                message={selectedMessage}
                onComposeDraftRequested={onComposeDraftRequested}
                pendingActions={pendingActions}
              />
            </Suspense>
          ) : (
            emptyState
          )}
        </m.div>
      </div>
    </section>
  );
};
