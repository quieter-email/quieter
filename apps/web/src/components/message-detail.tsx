"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Suspense } from "react";
import type { MailboxCategory, MessageListItem } from "~/lib/gmail/gmail";
import { EmptyMessageState } from "./empty-message-state";
import { MessageView } from "./message-view";

type MessageDetailProps = {
  activeMailbox: MailboxCategory;
  selectedMessage: MessageListItem | null;
  onMarkThreadAsRead?: (threadId: string) => void | Promise<void>;
  onMarkThreadAsUnread?: (threadId: string) => void | Promise<void>;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onUpdateLabels?: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
  isActionPending?: boolean;
};

export const MessageDetail = ({
  activeMailbox,
  isActionPending,
  onDeletePermanently,
  onMarkAsRead,
  onMarkAsUnread,
  onMarkThreadAsRead,
  onMarkThreadAsUnread,
  onMoveToTrash,
  onUpdateLabels,
  selectedMessage,
}: MessageDetailProps) => (
  <section className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
    <div
      className="h-full overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6"
      data-message-detail-scroll-container
    >
      {selectedMessage ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              <HugeiconsIcon className="animate-spin text-muted-foreground" icon={Loading03Icon} />
            </div>
          }
        >
          <MessageView
            activeMailbox={activeMailbox}
            isActionPending={isActionPending}
            message={selectedMessage}
            onDeletePermanently={onDeletePermanently}
            onMarkAsRead={onMarkAsRead}
            onMarkAsUnread={onMarkAsUnread}
            onMarkThreadAsRead={onMarkThreadAsRead}
            onMarkThreadAsUnread={onMarkThreadAsUnread}
            onMoveToTrash={onMoveToTrash}
            onUpdateLabels={onUpdateLabels}
          />
        </Suspense>
      ) : (
        <EmptyMessageState />
      )}
    </div>
  </section>
);
