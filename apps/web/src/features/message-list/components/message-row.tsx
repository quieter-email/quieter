"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { FileAttachmentIcon, MessageMultiple01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { splitMailAddressList } from "@quieter/mail/compose";
import { cn } from "@quieter/ui";
import { m, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type MouseEvent } from "react";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { SenderAvatar } from "~/components/sender-avatar";
import { MessageLabels } from "~/features/message-labels/components/message-labels";
import { createMailboxThreadMessageActionHandlers } from "~/features/message-thread/components/message-action-handlers";
import { MessageActionsContextMenu } from "~/features/message-thread/components/message-actions";
import { formatMessageListDate, parseSender } from "~/lib/gmail/message-utils";
import type { MessageListProps } from "./message-list-types";
import type { useMessageListSelection } from "./use-message-list-selection";

type MessageRowSelectionGesture = {
  additive: boolean;
  range: boolean;
};

type MessageRowGestureEvent = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

const getSelectionGesture = (event: MessageRowGestureEvent): MessageRowSelectionGesture => ({
  additive: event.metaKey || event.ctrlKey,
  range: event.shiftKey,
});

type MessageRowProps = {
  activeMailbox: MessageListProps["activeMailbox"];
  gmailLabels: MailboxLabel[];
  isActive?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxId: string;
  mailboxProvider: MessageListProps["mailboxProvider"];
  offsetY: number;
  onOpenDraft: MessageListProps["onOpenDraft"];
  onThreadPress: ReturnType<typeof useMessageListSelection>["handleThreadPress"];
  onThreadSelectionPress: ReturnType<typeof useMessageListSelection>["handleThreadSelectionPress"];
  pendingActions: MessageListProps["pendingActions"];
  className?: string;
  rowRef?: (element: HTMLLIElement | null) => void;
  dataIndex?: number;
  thread: ThreadListEntry;
  isNew?: boolean;
  staggerIndex?: number;
};

type MessageRowContentProps = Omit<
  MessageRowProps,
  "className" | "dataIndex" | "offsetY" | "rowRef"
>;

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
    className="squircle inline-flex h-4.5 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/75 px-1 text-[10.5px] font-medium text-muted-foreground tabular-nums shadow-xs"
    title={title}
  >
    <HugeiconsIcon aria-hidden className="size-3" icon={icon} />
    <span>{label}</span>
  </span>
);

const MessageRowContent = ({
  activeMailbox,
  gmailLabels,
  isActive,
  isSelected,
  isSelectionMode,
  mailboxActions,
  mailboxId,
  mailboxProvider,
  onOpenDraft,
  onThreadPress,
  onThreadSelectionPress,
  pendingActions,
  thread,
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
  const date = formatMessageListDate(anchorMessage);
  const unread = !isDraftMailbox && thread.unreadCount > 0;
  const threaded = thread.messageCount > 1;
  const attachmentCount = thread.attachmentCount;
  const threadLabelIds = Array.from(
    new Set(thread.messages.flatMap((message) => message.labelIds ?? [])),
  );
  const showSelectionControl = !!isSelectionMode;
  const isActionPending =
    pendingActions.isMessageActionPending(anchorMessage.id) ||
    pendingActions.isThreadActionPending(thread.threadId);
  const metaTextClassName = cn("text-xs tabular-nums", {
    "font-semibold text-foreground/90": unread,
    "text-muted-foreground": !unread,
    "text-foreground/75": isActive && !unread,
  });
  const selectionAriaLabel = isDraftMailbox ? "Select draft" : "Select conversation";
  const handleSelectionPress = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onThreadSelectionPress(thread, getSelectionGesture(event));
  };
  const handleSelectionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onThreadSelectionPress(thread, getSelectionGesture(event));
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
    onThreadPress(thread, gesture);
  };
  const handleRowClick = (event: MouseEvent<HTMLButtonElement>) => {
    const gesture = getSelectionGesture(event);

    if (gesture.additive || gesture.range) {
      return;
    }

    onThreadPress(thread, gesture);
  };

  return (
    <div
      className={cn(
        "relative flex h-17 items-stretch overflow-hidden rounded-xl transition-transform duration-100 ease-out motion-safe:has-[button:active]:scale-[0.98]",
        {
          "bg-muted/80 ring-1 ring-border/80 ring-inset": isSelected,
          "bg-muted": isActive && !isSelected,
          "bg-background-light/55": unread && !isActive && !isSelected,
          "group-hover:bg-muted/45": !isActive && !isSelected,
        },
      )}
    >
      {unread && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 h-8 w-0.75 -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <div className="relative ml-3 flex h-full w-9.5 shrink-0 items-center justify-center">
        <button
          aria-label={selectionAriaLabel}
          aria-pressed={!!isSelected}
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
            className="size-9.5 rounded-lg"
            fallbackLabel={senderInitial}
          />
        </button>

        <button
          aria-label={selectionAriaLabel}
          aria-pressed={!!isSelected}
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
              "flex size-4.5 items-center justify-center rounded-[5px] border bg-background text-transparent shadow-xs transition-[background-color,border-color,color,box-shadow] duration-100 ease-out",
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
        actions={createMailboxThreadMessageActionHandlers({
          mailboxActions,
          onOpenDraft,
          supportsFolders: mailboxProvider === "gmail",
          supportsLabels: true,
          supportsUnsubscribe: mailboxProvider === "gmail",
        })}
        isPending={isActionPending}
        mailboxId={mailboxId}
        mailbox={activeMailbox}
        message={anchorMessage}
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

          <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3 px-3">
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden">
              <div className="flex w-full min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 truncate text-left text-[13px]/4.5 text-foreground">
                  {isDraftMailbox && <span className="font-medium text-muted-foreground">To </span>}
                  <span className={cn({ "font-semibold": unread, "font-medium": !unread })}>
                    {senderLabel}
                  </span>
                  {senderEmail && (
                    <span className="ml-2 text-[11px] text-muted-foreground">{senderEmail}</span>
                  )}
                </p>

                <div className="flex shrink-0 items-center gap-2">
                  {attachmentCount > 0 && (
                    <MessageRowMetaBadge
                      icon={FileAttachmentIcon}
                      label={String(attachmentCount)}
                      title={
                        attachmentCount === 1
                          ? "This thread has 1 attachment."
                          : `This thread has ${attachmentCount} attachments.`
                      }
                    />
                  )}
                  {threaded && (
                    <MessageRowMetaBadge
                      icon={MessageMultiple01Icon}
                      label={String(thread.messageCount)}
                      title={
                        thread.messageCount === 1
                          ? "This thread has 1 message."
                          : `This thread has ${thread.messageCount} messages.`
                      }
                    />
                  )}
                  <span className={metaTextClassName} suppressHydrationWarning>
                    {date || "--"}
                  </span>
                </div>
              </div>

              <div className="flex w-full min-w-0 items-center gap-1.5">
                <p
                  className={cn("min-w-0 flex-1 truncate text-left text-[13px]/4.5", {
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
                <MessageLabels
                  className="shrink-0 flex-nowrap"
                  compact
                  labelIds={threadLabelIds}
                  labels={gmailLabels}
                  limit={2}
                />
              </div>
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
  gmailLabels,
  isActive,
  isSelected,
  isSelectionMode,
  mailboxActions,
  mailboxId,
  mailboxProvider,
  offsetY,
  onOpenDraft,
  onThreadPress,
  onThreadSelectionPress,
  pendingActions,
  rowRef,
  thread,
  isNew,
  staggerIndex = 0,
}: MessageRowProps) => {
  const shouldReduceMotion = useReducedMotion();

  const element = (
    <MessageRowContent
      activeMailbox={activeMailbox}
      gmailLabels={gmailLabels}
      isActive={isActive}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      mailboxActions={mailboxActions}
      mailboxId={mailboxId}
      mailboxProvider={mailboxProvider}
      onOpenDraft={onOpenDraft}
      onThreadPress={onThreadPress}
      onThreadSelectionPress={onThreadSelectionPress}
      pendingActions={pendingActions}
      thread={thread}
    />
  );

  return (
    <li
      className={cn("group relative", className, {
        "overflow-hidden": isNew,
      })}
      data-index={dataIndex}
      ref={rowRef}
      style={{
        transform: `translateY(${offsetY}px)`,
      }}
    >
      {isNew ? (
        <m.div
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 24,
            mass: 0.8,
            delay: staggerIndex * 0.05,
          }}
        >
          {element}
        </m.div>
      ) : (
        element
      )}
    </li>
  );
};
