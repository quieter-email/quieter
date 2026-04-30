"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  pendingActions: MailboxPendingActions;
  selectedMessage: MessageListItem | null;
};

const MessageDetailLoadingSkeleton = () => (
  <div className="mx-auto w-full max-w-3xl space-y-6 py-6" role="status">
    <span className="sr-only">Loading message...</span>
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
  onComposeDraftRequested,
  pendingActions,
  selectedMessage,
  mailboxId,
}: MessageDetailProps) => {
  const emptyState =
    activeMailbox === "drafts" ? (
      <EmptyMessageState
        description="Open a draft from the list to continue editing it."
        title="Drafts stay editable"
      />
    ) : (
      <EmptyMessageState />
    );

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background-light">
      <div
        className="h-full overflow-y-auto px-4 sm:px-5 lg:px-6"
        data-message-detail-scroll-container
      >
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
              message={selectedMessage}
              onComposeDraftRequested={onComposeDraftRequested}
              pendingActions={pendingActions}
            />
          </Suspense>
        ) : (
          emptyState
        )}
      </div>
    </section>
  );
};
