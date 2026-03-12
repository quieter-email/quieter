"use client";

import type { CSSProperties } from "react";
import { cn } from "@quietr/ui";
import { useQuery } from "@tanstack/react-query";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { MessageActionsContextMenu } from "./message-actions";
import { SenderAvatar } from "./sender-avatar";

type MessageRowProps = {
  activeMailbox: MailboxCategory;
  thread: ThreadListEntry;
  isActive?: boolean;
  onActivateMessage: (messageId: string) => void;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onUpdateLabels?: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
  isActionPending?: boolean;
  className?: string;
  style?: CSSProperties;
  rowRef?: (element: HTMLLIElement | null) => void;
  dataIndex?: number;
};

export const MessageRow = ({
  activeMailbox,
  className,
  dataIndex,
  isActionPending,
  isActive,
  onActivateMessage,
  onDeletePermanently,
  onMarkAsRead,
  onMarkAsUnread,
  onMoveToTrash,
  onUpdateLabels,
  rowRef,
  style,
  thread,
}: MessageRowProps) => {
  const anchorMessage = thread.anchorMessage;
  const subject = anchorMessage.subject || "(No subject)";
  const sender = parseSender(anchorMessage.from);
  const senderLabel = sender.name || sender.email || sender.display;
  const senderEmail = sender.name ? sender.email : "";
  const senderInitial = (senderLabel.trim().charAt(0) || "?").toUpperCase();
  const date = formatMessageDate(anchorMessage, "compact");
  const unread = thread.unreadCount > 0;
  const threaded = thread.messageCount > 1;
  const threadDetailsQuery = useQuery({
    ...getThreadWithDetailsOptions(activeMailbox, thread.threadId),
    enabled: Boolean(isActive),
  });
  const attachmentCount =
    threadDetailsQuery.data?.messages.reduce(
      (count, message) => count + (message.attachments?.length ?? 0),
      0,
    ) ?? 0;
  const metaTextClassName = cn("text-xs tabular-nums", {
    "font-semibold text-foreground/90": unread,
    "text-muted-foreground": !unread,
    "text-foreground/75": isActive && !unread,
  });

  return (
    <li
      className={cn("group relative", className)}
      data-index={dataIndex}
      ref={rowRef}
      style={style}
    >
      <MessageActionsContextMenu
        isPending={isActionPending}
        mailbox={activeMailbox}
        message={anchorMessage}
        onDeletePermanently={onDeletePermanently}
        onMarkAsRead={onMarkAsRead}
        onMarkAsUnread={onMarkAsUnread}
        onMoveToTrash={onMoveToTrash}
        onTriggerClick={() => {
          void onMarkAsRead?.(anchorMessage.id);
          onActivateMessage(anchorMessage.id);
        }}
        onUpdateLabels={onUpdateLabels}
        triggerAriaCurrent={isActive ? "true" : undefined}
        triggerClassName={cn(
          "group relative flex h-[72px] w-full min-w-0 overflow-hidden rounded-lg px-4 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none [&>button]:flex [&>button]:h-full [&>button]:w-full [&>button]:min-w-0 [&>button]:items-center [&>button]:text-left",
          {
            "bg-muted": isActive,
            "bg-background-light": unread && !isActive,
            "bg-transparent hover:bg-muted/50": !isActive,
          },
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <SenderAvatar
            avatarUrlDark={anchorMessage.senderAvatarUrls?.dark}
            avatarUrlLight={anchorMessage.senderAvatarUrls?.light}
            className="size-10 rounded-lg"
            fallbackLabel={senderInitial}
          />

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 overflow-hidden">
            <div className="flex w-full min-w-0 items-center justify-between gap-2">
              <p className="min-w-0 truncate text-left text-sm text-foreground">
                <span className={cn(unread ? "font-semibold" : "font-medium")}>{senderLabel}</span>
                {senderEmail ? (
                  <span className="ml-2 text-xs text-muted-foreground">{senderEmail}</span>
                ) : null}
              </p>

              <div className="flex shrink-0 items-center gap-1.5">
                {attachmentCount > 0 ? (
                  <span
                    className="text-[11px] text-muted-foreground"
                    title={
                      attachmentCount === 1
                        ? "This thread has 1 attachment."
                        : `This thread has ${attachmentCount} attachments.`
                    }
                  >
                    {attachmentCount === 1 ? "file" : `${attachmentCount} files`}
                  </span>
                ) : null}
                {threaded && <span className={metaTextClassName}>{thread.messageCount}x</span>}
                <span className={metaTextClassName}>{date || "--"}</span>
              </div>
            </div>

            <p
              className={cn("w-full min-w-0 truncate text-left text-sm", {
                "font-medium text-foreground": unread,
                "text-foreground-light": !unread,
              })}
            >
              {subject}
            </p>
          </div>
        </div>
      </MessageActionsContextMenu>
    </li>
  );
};
