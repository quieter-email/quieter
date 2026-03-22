"use client";

import { splitMailAddressList } from "@quietr/trpc/compose";
import { cn } from "@quietr/ui";
import { useQuery } from "@tanstack/react-query";
import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { MessageActionsContextMenu } from "./message-actions";
import { SenderAvatar } from "./sender-avatar";

type MessageRowSelectionGesture = {
  additive: boolean;
  range: boolean;
};

type MessageRowProps = {
  activeMailbox: MailboxCategory;
  userId: string;
  isActive?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onDeleteDraft?: (message: ThreadListEntry["anchorMessage"]) => void | Promise<void>;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsSpam?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onOpenDraft?: (message: ThreadListEntry["anchorMessage"]) => void | Promise<void>;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onUpdateLabels?: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
  onUnmarkAsSpam?: (messageId: string) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
  onPress?: (thread: ThreadListEntry, gesture: MessageRowSelectionGesture) => void;
  onSelectionPress?: (thread: ThreadListEntry, gesture: MessageRowSelectionGesture) => void;
  isActionPending?: boolean;
  className?: string;
  style?: CSSProperties;
  rowRef?: (element: HTMLLIElement | null) => void;
  dataIndex?: number;
  thread: ThreadListEntry;
};

type MessageRowContentProps = Omit<MessageRowProps, "className" | "dataIndex" | "rowRef" | "style">;

const MessageRowContent = memo(
  ({
    activeMailbox,
    isActionPending,
    isActive,
    isSelected,
    isSelectionMode,
    onDeleteDraft,
    onDeletePermanently,
    onMarkAsRead,
    onMarkAsSpam,
    onMarkAsUnread,
    onMoveToTrash,
    onOpenDraft,
    onPress,
    onSelectionPress,
    onUnsubscribe,
    onUnmarkAsSpam,
    onUpdateLabels,
    thread,
    userId,
  }: MessageRowContentProps) => {
    const anchorMessage = thread.anchorMessage;
    const subject = anchorMessage.subject || "(No subject)";
    const isDraftMailbox = activeMailbox === "drafts";
    const draftRecipient = splitMailAddressList(anchorMessage.to)[0] ?? anchorMessage.to ?? "";
    const sender = parseSender(isDraftMailbox ? draftRecipient : anchorMessage.from);
    const senderLabel = isDraftMailbox
      ? sender.name || sender.email || sender.display || "No recipients"
      : sender.name || sender.email || sender.display;
    const senderEmail = sender.name ? sender.email : "";
    const senderInitial = (senderLabel.trim().charAt(0) || "?").toUpperCase();
    const date = formatMessageDate(anchorMessage, "compact");
    const unread = !isDraftMailbox && thread.unreadCount > 0;
    const threaded = thread.messageCount > 1;
    const threadDetailsQuery = useQuery(
      getThreadWithDetailsOptions(userId, activeMailbox, thread.threadId, Boolean(isActive)),
    );
    const attachmentCount =
      threadDetailsQuery.data?.messages.reduce(
        (count, message) => count + (message.attachments?.length ?? 0),
        0,
      ) ?? 0;
    const showSelectionControl = Boolean(isSelectionMode);
    const metaTextClassName = cn("text-xs tabular-nums", {
      "font-semibold text-foreground/90": unread,
      "text-muted-foreground": !unread,
      "text-foreground/75": isActive && !unread,
    });
    const selectionAriaLabel = isDraftMailbox ? "Select draft" : "Select conversation";
    const getSelectionGesture = (event: {
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    }): MessageRowSelectionGesture => ({
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    });
    const handleSelectionPress = (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSelectionPress?.(thread, getSelectionGesture(event));
    };
    const handleSelectionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== " " && event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSelectionPress?.(thread, getSelectionGesture(event));
    };
    const handleRowMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      const gesture = getSelectionGesture(event);

      if (!gesture.additive && !gesture.range) {
        return;
      }

      event.preventDefault();
      onPress?.(thread, gesture);
    };
    const handleRowClick = (event: MouseEvent<HTMLButtonElement>) => {
      const gesture = getSelectionGesture(event);

      if (gesture.additive || gesture.range) {
        return;
      }

      onPress?.(thread, gesture);
    };

    return (
      <div className="relative flex h-[72px] items-stretch gap-3">
        <div className="relative flex h-full w-10 shrink-0 items-center justify-center">
          <button
            aria-label={selectionAriaLabel}
            aria-pressed={Boolean(isSelected)}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-xl transition-[opacity,transform] duration-100 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              {
                "pointer-events-none scale-95 opacity-0": showSelectionControl,
                "scale-100 opacity-100": !showSelectionControl,
              },
            )}
            disabled={isActionPending}
            onKeyDown={handleSelectionKeyDown}
            onMouseDown={handleSelectionPress}
            type="button"
          >
            <SenderAvatar
              avatarUrlDark={anchorMessage.senderAvatarUrls?.dark}
              avatarUrlLight={anchorMessage.senderAvatarUrls?.light}
              className="size-10 rounded-lg"
              fallbackLabel={senderInitial}
            />
          </button>

          <button
            aria-label={selectionAriaLabel}
            aria-pressed={Boolean(isSelected)}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-xl transition-[opacity,transform] duration-100 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              {
                "scale-100 opacity-100": showSelectionControl,
                "pointer-events-none scale-95 opacity-0": !showSelectionControl,
              },
            )}
            disabled={isActionPending}
            onKeyDown={handleSelectionKeyDown}
            onMouseDown={handleSelectionPress}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-[18px] items-center justify-center rounded-[5px] border bg-background text-transparent shadow-xs transition-[background-color,border-color,color,box-shadow] duration-100 ease-out",
                {
                  "border-primary bg-primary text-primary-foreground": isSelected,
                  "border-input": !isSelected,
                },
              )}
            >
              <svg
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 14 14"
              >
                <path d="M3 7.5 5.75 10 11 4.75" />
              </svg>
            </span>
          </button>
        </div>

        <MessageActionsContextMenu
          isPending={isActionPending}
          onDeleteDraft={onDeleteDraft}
          mailbox={activeMailbox}
          message={anchorMessage}
          userId={userId}
          onDeletePermanently={onDeletePermanently}
          onMarkAsRead={onMarkAsRead}
          onMarkAsSpam={onMarkAsSpam}
          onMarkAsUnread={onMarkAsUnread}
          onMoveToTrash={onMoveToTrash}
          onOpenDraft={onOpenDraft}
          onUnmarkAsSpam={onUnmarkAsSpam}
          onUnsubscribe={onUnsubscribe}
          onUpdateLabels={onUpdateLabels}
          triggerClassName={cn("flex h-full min-w-0 flex-1")}
        >
          <button
            aria-current={isActive ? "true" : undefined}
            className="group relative flex h-full min-w-0 flex-1 items-center rounded-xl text-left transition-transform duration-100 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.998]"
            onClick={handleRowClick}
            onMouseDown={handleRowMouseDown}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-x-0 inset-y-0.5 rounded-xl transition-[background-color,border-color,box-shadow] duration-100 ease-out",
                {
                  "bg-muted/80 ring-1 ring-border/80 ring-inset": isSelected,
                  "bg-muted": isActive && !isSelected,
                  "bg-background-light/85": unread && !isActive && !isSelected,
                  "group-hover:bg-muted/45": !isActive && !isSelected,
                },
              )}
            />

            <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3.5 px-4">
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 overflow-hidden">
                <div className="flex w-full min-w-0 items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-left text-sm text-foreground">
                    {isDraftMailbox ? (
                      <span className="font-medium text-muted-foreground">To </span>
                    ) : null}
                    <span className={cn({ "font-semibold": unread, "font-medium": !unread })}>
                      {senderLabel}
                    </span>
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
                  {isDraftMailbox ? (
                    <>
                      <span className="mr-2 font-medium text-destructive">Draft</span>
                      {subject}
                    </>
                  ) : (
                    subject
                  )}
                </p>
              </div>
            </div>
          </button>
        </MessageActionsContextMenu>
      </div>
    );
  },
);

export const MessageRow = ({
  activeMailbox,
  className,
  dataIndex,
  isActionPending,
  isActive,
  isSelected,
  isSelectionMode,
  onDeleteDraft,
  onDeletePermanently,
  onMarkAsRead,
  onMarkAsSpam,
  onMarkAsUnread,
  onMoveToTrash,
  onOpenDraft,
  onPress,
  onSelectionPress,
  onUnsubscribe,
  onUnmarkAsSpam,
  onUpdateLabels,
  rowRef,
  style,
  thread,
  userId,
}: MessageRowProps) => {
  return (
    <li
      className={cn("group relative", className)}
      data-index={dataIndex}
      ref={rowRef}
      style={style}
    >
      <MessageRowContent
        activeMailbox={activeMailbox}
        isActionPending={isActionPending}
        isActive={isActive}
        isSelected={isSelected}
        isSelectionMode={isSelectionMode}
        onDeleteDraft={onDeleteDraft}
        onDeletePermanently={onDeletePermanently}
        onMarkAsRead={onMarkAsRead}
        onMarkAsSpam={onMarkAsSpam}
        onMarkAsUnread={onMarkAsUnread}
        onMoveToTrash={onMoveToTrash}
        onOpenDraft={onOpenDraft}
        onPress={onPress}
        onSelectionPress={onSelectionPress}
        onUnsubscribe={onUnsubscribe}
        onUnmarkAsSpam={onUnmarkAsSpam}
        onUpdateLabels={onUpdateLabels}
        thread={thread}
        userId={userId}
      />
    </li>
  );
};
