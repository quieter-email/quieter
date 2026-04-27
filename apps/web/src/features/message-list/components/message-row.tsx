"use client";

import { FileAttachmentIcon, MessageMultiple01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { splitMailAddressList } from "@quieter/orpc/compose";
import { cn } from "@quieter/ui";
import { type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { SenderAvatar } from "~/components/sender-avatar";
import { MessageActionsContextMenu } from "~/features/message-thread/components/message-actions";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";

type MessageRowSelectionGesture = {
  additive: boolean;
  range: boolean;
};

type MessageRowProps = {
  activeMailbox: MailboxCategory;
  mailboxId: string;
  isActive?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onDeleteDraft?: (message: ThreadListEntry["anchorMessage"]) => void | Promise<void>;
  onMarkThreadAsRead?: (threadId: string) => void | Promise<void>;
  onMarkThreadAsSpam?: (threadId: string) => void | Promise<void>;
  onMarkThreadAsUnread?: (threadId: string) => void | Promise<void>;
  onOpenDraft?: (message: ThreadListEntry["anchorMessage"]) => void | Promise<void>;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onUpdateThreadLabels?: (
    threadId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveThreadToTrash?: (threadId: string) => void | Promise<void>;
  onUntrashThread?: (threadId: string) => void | Promise<void>;
  onUnmarkThreadAsSpam?: (threadId: string) => void | Promise<void>;
  onDeleteThreadPermanently?: (threadId: string) => void | Promise<void>;
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

const MessageRowMetaBadge = ({
  icon,
  label,
  title,
}: {
  icon: IconSvgElement;
  label: string;
  title: string;
}) => (
  <span
    className="squircle inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/75 px-1.5 text-[11px] leading-none font-medium text-muted-foreground tabular-nums shadow-xs"
    title={title}
  >
    <HugeiconsIcon aria-hidden className="size-3.5" icon={icon} />
    <span>{label}</span>
  </span>
);

const MessageRowContent = ({
  activeMailbox,
  isActionPending,
  isActive,
  isSelected,
  isSelectionMode,
  onDeleteDraft,
  onDeleteThreadPermanently,
  onMarkThreadAsRead,
  onMarkThreadAsSpam,
  onMarkThreadAsUnread,
  onMoveThreadToTrash,
  onOpenDraft,
  onPress,
  onSelectionPress,
  onUntrashThread,
  onUnsubscribe,
  onUnmarkThreadAsSpam,
  onUpdateThreadLabels,
  thread,
  mailboxId,
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
  const attachmentCount = thread.attachmentCount;
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
    <div
      className={cn(
        "relative flex h-[72px] items-stretch overflow-hidden rounded-xl transition-transform duration-100 ease-out motion-safe:has-[button:active]:scale-[0.98]",
        {
          "bg-muted/80 ring-1 ring-border/80 ring-inset": isSelected,
          "bg-muted": isActive && !isSelected,
          "bg-background-light/85": unread && !isActive && !isSelected,
          "group-hover:bg-muted/45": !isActive && !isSelected,
        },
      )}
    >
      {unread ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 h-9 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
        />
      ) : null}
      <div className="relative ml-3.5 flex h-full w-10 shrink-0 items-center justify-center">
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
        mailboxId={mailboxId}
        onDeleteDraft={onDeleteDraft}
        mailbox={activeMailbox}
        message={anchorMessage}
        onDeletePermanently={() => {
          void onDeleteThreadPermanently?.(thread.threadId);
        }}
        onMarkAsRead={() => {
          void onMarkThreadAsRead?.(thread.threadId);
        }}
        onMarkAsSpam={() => {
          void onMarkThreadAsSpam?.(thread.threadId);
        }}
        onMarkAsUnread={() => {
          void onMarkThreadAsUnread?.(thread.threadId);
        }}
        onMoveToTrash={() => {
          void onMoveThreadToTrash?.(thread.threadId);
        }}
        onOpenDraft={onOpenDraft}
        onUnmarkAsSpam={() => {
          void onUnmarkThreadAsSpam?.(thread.threadId);
        }}
        onUntrash={() => {
          void onUntrashThread?.(thread.threadId);
        }}
        onUnsubscribe={onUnsubscribe}
        onUpdateLabels={
          onUpdateThreadLabels
            ? (_messageId, changes) => onUpdateThreadLabels(thread.threadId, changes)
            : undefined
        }
        triggerClassName="flex h-full min-w-0 flex-1 active:scale-100"
      >
        <button
          aria-current={isActive ? "true" : undefined}
          className="group relative flex h-full min-w-0 flex-1 items-center rounded-xl text-left transition-transform duration-100 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={handleRowClick}
          onMouseDown={handleRowMouseDown}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 inset-y-0.5 rounded-xl transition-[background-color,border-color,box-shadow] duration-100 ease-out",
            )}
          />

          <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3.5 px-3.5">
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

                <div className="flex shrink-0 items-center gap-2">
                  {attachmentCount > 0 ? (
                    <MessageRowMetaBadge
                      icon={FileAttachmentIcon}
                      label={String(attachmentCount)}
                      title={
                        attachmentCount === 1
                          ? "This thread has 1 attachment."
                          : `This thread has ${attachmentCount} attachments.`
                      }
                    />
                  ) : null}
                  {threaded ? (
                    <MessageRowMetaBadge
                      icon={MessageMultiple01Icon}
                      label={String(thread.messageCount)}
                      title={
                        thread.messageCount === 1
                          ? "This thread has 1 message."
                          : `This thread has ${thread.messageCount} messages.`
                      }
                    />
                  ) : null}
                  <span className={metaTextClassName}>{date || "--"}</span>
                </div>
              </div>

              <p
                className={cn("w-full min-w-0 truncate text-left text-sm", {
                  "font-medium text-foreground": unread,
                  "text-muted-foreground": !unread,
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
};

export const MessageRow = ({
  activeMailbox,
  className,
  dataIndex,
  isActionPending,
  isActive,
  isSelected,
  isSelectionMode,
  onDeleteDraft,
  onDeleteThreadPermanently,
  onMarkThreadAsRead,
  onMarkThreadAsSpam,
  onMarkThreadAsUnread,
  onMoveThreadToTrash,
  onOpenDraft,
  onPress,
  onSelectionPress,
  onUntrashThread,
  onUnsubscribe,
  onUnmarkThreadAsSpam,
  onUpdateThreadLabels,
  rowRef,
  style,
  thread,
  mailboxId,
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
        onDeleteThreadPermanently={onDeleteThreadPermanently}
        onMarkThreadAsRead={onMarkThreadAsRead}
        onMarkThreadAsSpam={onMarkThreadAsSpam}
        onMarkThreadAsUnread={onMarkThreadAsUnread}
        onMoveThreadToTrash={onMoveThreadToTrash}
        onOpenDraft={onOpenDraft}
        onPress={onPress}
        onSelectionPress={onSelectionPress}
        onUntrashThread={onUntrashThread}
        onUnsubscribe={onUnsubscribe}
        onUnmarkThreadAsSpam={onUnmarkThreadAsSpam}
        onUpdateThreadLabels={onUpdateThreadLabels}
        thread={thread}
        mailboxId={mailboxId}
      />
    </li>
  );
};
