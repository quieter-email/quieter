"use client";

import {
  FileAttachmentIcon,
  MessageMultiple01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { splitMailAddressList } from "@quieter/mail/compose/schema";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { cn } from "@quieter/ui/cn";
import { m, useReducedMotion } from "motion/react";
import type { FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { useState } from "react";

import { SenderAvatar } from "#/components/sender-avatar";
import { MessageLabels } from "#/features/message-labels/components/message-labels";
import { createMailboxThreadMessageActionHandlers } from "#/features/message-thread/components/message-action-handlers";
import { MessageActionsContextMenu } from "#/features/message-thread/components/message-actions";
import {
  appEaseOut,
  appMotionDuration,
  getAppStaggerDelay,
} from "#/features/motion/app-motion";
import { formatMessageListDate, parseSender } from "#/lib/gmail/message-utils";
import type { ThreadListEntry } from "#/lib/gmail/thread-list";

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

const getSelectionGesture = (
  event: MessageRowGestureEvent
): MessageRowSelectionGesture => ({
  additive: event.metaKey || event.ctrlKey,
  range: event.shiftKey,
});

const getMessageRowSubject = (message: ThreadListEntry["anchorMessage"]) => {
  const subjectValue = message.subject?.trim() ?? "";
  return subjectValue.length > 0 ? subjectValue : "(No subject)";
};

const getMessageRowSender = (
  message: ThreadListEntry["anchorMessage"],
  isDraftMailbox: boolean
) => {
  const draftRecipient =
    splitMailAddressList(message.to)[0] ?? message.to ?? "";
  const sender = parseSender(isDraftMailbox ? draftRecipient : message.from);
  const senderLabel = isDraftMailbox
    ? sender.name || sender.email || sender.display || "No recipients"
    : sender.name || sender.email || sender.display;

  return {
    senderEmail: sender.name ? sender.email : "",
    senderInitial: (senderLabel.trim().charAt(0) || "?").toUpperCase(),
    senderLabel,
  };
};

const getMessageRowSurfaceOpacity = (
  isActive: boolean,
  isHovered: boolean,
  isSelected: boolean
) => {
  if (isActive) {
    return 1;
  }
  if (isSelected) {
    return isHovered ? 0.9 : 0.75;
  }
  return isHovered ? 0.5 : 0;
};

const getMessageRowOpenAriaLabel = (
  isActive: boolean,
  isDraftMailbox: boolean,
  subject: string
) => {
  if (isDraftMailbox) {
    return `Open draft: ${subject}`;
  }
  return `${isActive ? "Close" : "Open"} conversation: ${subject}`;
};

const rowPressTransition = {
  damping: 28,
  mass: 0.7,
  stiffness: 700,
  type: "spring",
} as const;

type MessageRowProps = {
  activeMailbox: MessageListProps["activeMailbox"];
  gmailLabels: MailboxLabel[];
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxId: string;
  mailboxProvider: MessageListProps["mailboxProvider"];
  offsetY: number;
  onOpenDraft: MessageListProps["onOpenDraft"];
  onKeyboardOpen?: () => void;
  onThreadFocus: (threadId: string | null) => void;
  onThreadIntent: (threadId: string | null) => void;
  onThreadPress: ReturnType<
    typeof useMessageListSelection
  >["handleThreadPress"];
  onThreadSelectionPress: ReturnType<
    typeof useMessageListSelection
  >["handleThreadSelectionPress"];
  pendingActions: MessageListProps["pendingActions"];
  className?: string;
  rowRef?: (element: HTMLLIElement | null) => void;
  dataIndex?: number;
  thread: ThreadListEntry;
  state?: MessageRowState;
  isNew?: boolean;
  staggerIndex?: number;
};

type MessageRowState = {
  active?: boolean;
  selected?: boolean;
  selectionMode?: boolean;
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
    className="squircle inline-flex h-4.5 shrink-0 items-center gap-1 rounded-md border border-border bg-bg/75 px-1 text-[10.5px] font-medium text-muted-fg tabular-nums shadow-xs"
    title={title}
  >
    <HugeiconsIcon aria-hidden className="size-3" icon={icon} />
    <span>{label}</span>
  </span>
);

const MessageRowSelectionButton = ({
  isActionPending,
  isSelected,
  onThreadSelectionPress,
  reducedMotion,
  selectionAriaLabel,
  senderInitial,
  setIsSelectHovered,
  showCheckbox,
  thread,
}: {
  isActionPending: boolean;
  isSelected: boolean;
  onThreadSelectionPress: MessageRowProps["onThreadSelectionPress"];
  reducedMotion: boolean | null;
  selectionAriaLabel: string;
  senderInitial: string;
  setIsSelectHovered: (hovered: boolean) => void;
  showCheckbox: boolean;
  thread: ThreadListEntry;
}) => {
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

  return (
    <div className="relative z-10 ml-2 flex h-full shrink-0 items-center justify-center @sm:ml-3">
      <button
        aria-label={selectionAriaLabel}
        aria-pressed={isSelected}
        className="relative size-9.5 rounded-lg border border-transparent focus-visible:z-20 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none disabled:pointer-events-none"
        disabled={isActionPending}
        onKeyDown={handleSelectionKeyDown}
        onMouseDown={handleSelectionPress}
        onMouseEnter={() => {
          setIsSelectHovered(true);
        }}
        onMouseLeave={() => {
          setIsSelectHovered(false);
        }}
        tabIndex={-1}
        type="button"
      >
        <m.span
          animate={{
            opacity: showCheckbox ? 0 : 1,
            scale: reducedMotion !== false || !showCheckbox ? 1 : 0.92,
          }}
          className="block"
          initial={false}
          transition={{
            duration: appMotionDuration.feedback,
            ease: appEaseOut,
          }}
        >
          <SenderAvatar
            avatarUrlDark={thread.anchorMessage.senderAvatarUrls?.dark}
            avatarUrlLight={thread.anchorMessage.senderAvatarUrls?.light}
            className="size-9.5 rounded-lg"
            fallbackLabel={senderInitial}
          />
        </m.span>

        <m.span
          animate={{
            opacity: showCheckbox ? 1 : 0,
            scale: reducedMotion !== false || showCheckbox ? 1 : 0.8,
          }}
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          transition={{
            duration: appMotionDuration.feedback,
            ease: appEaseOut,
          }}
        >
          <span
            className={cn(
              "flex size-4.5 items-center justify-center rounded-[5px] border bg-bg text-transparent shadow-xs transition-[background-color,border-color,color] duration-(--app-motion-duration-feedback) ease-(--app-motion-ease-out)",
              {
                "border-border": !isSelected,
                "border-primary bg-primary text-primary-fg": isSelected,
              }
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
        </m.span>
      </button>
    </div>
  );
};

const MessageRowDetails = ({
  date,
  gmailLabels,
  isDraftMailbox,
  metaTextClassName,
  senderEmail,
  senderLabel,
  subject,
  thread,
  threaded,
  unread,
}: {
  date: string;
  gmailLabels: MailboxLabel[];
  isDraftMailbox: boolean;
  metaTextClassName: string;
  senderEmail: string;
  senderLabel: string;
  subject: string;
  thread: ThreadListEntry;
  threaded: boolean;
  unread: boolean;
}) => (
  <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2 px-2 @sm:gap-3 @sm:px-3">
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden">
      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-left text-[13px]/4.5 text-fg">
          {isDraftMailbox && (
            <span className="font-medium text-muted-fg">To </span>
          )}
          <span
            className={cn({
              "font-medium": !unread,
              "font-semibold": unread,
            })}
          >
            {senderLabel}
          </span>
          {senderEmail && (
            <span className="ml-2 hidden text-[11px] text-muted-fg @sm:inline">
              {senderEmail}
            </span>
          )}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          {thread.attachmentCount > 0 && (
            <MessageRowMetaBadge
              icon={FileAttachmentIcon}
              label={String(thread.attachmentCount)}
              title={
                thread.attachmentCount === 1
                  ? "This thread has 1 attachment."
                  : `This thread has ${thread.attachmentCount} attachments.`
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
            "font-medium text-fg": unread,
            "text-muted-fg": !unread,
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
        <div className="hidden shrink-0 @sm:block">
          <MessageLabels
            compact
            labelIds={thread.threadLabelIds}
            labels={gmailLabels}
            limit={2}
          />
        </div>
      </div>
    </div>
  </div>
);

const useMessageRowHandlers = ({
  isActionPending,
  isActive,
  mailboxActions,
  mailboxProvider,
  onKeyboardOpen,
  onThreadFocus,
  onThreadIntent,
  onThreadPress,
  onThreadSelectionPress,
  showSelectionControl,
  thread,
  unread,
}: {
  isActionPending: boolean;
  isActive: boolean;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxProvider: MessageListProps["mailboxProvider"];
  onKeyboardOpen?: () => void;
  onThreadFocus: (threadId: string | null) => void;
  onThreadIntent: (threadId: string | null) => void;
  onThreadPress: MessageRowProps["onThreadPress"];
  onThreadSelectionPress: MessageRowProps["onThreadSelectionPress"];
  showSelectionControl: boolean;
  thread: ThreadListEntry;
  unread: boolean;
}) => {
  const handleRowMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const gesture = getSelectionGesture(event);

    if (gesture.additive || gesture.range) {
      onThreadPress(thread, gesture);
    }
  };
  const handleRowClick = (event: MouseEvent<HTMLButtonElement>) => {
    const gesture = getSelectionGesture(event);

    if (gesture.additive || gesture.range) {
      return;
    }

    if (!isActive && event.detail === 0) {
      onKeyboardOpen?.();
    }

    if (
      !showSelectionControl &&
      unread &&
      mailboxProvider !== "api" &&
      !isActionPending
    ) {
      void mailboxActions.markThreadAsRead(thread.threadId);
    }

    onThreadPress(thread, gesture);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      event.key !== " " ||
      (!event.metaKey && !event.ctrlKey && !event.shiftKey)
    ) {
      return;
    }

    event.preventDefault();
    onThreadSelectionPress(thread, getSelectionGesture(event));
  };
  const handleRowFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement)) {
      return;
    }
    if (!Object.hasOwn(event.target.dataset, "messageRowTrigger")) {
      return;
    }

    onThreadFocus(thread.threadId);
    onThreadIntent(thread.threadId);
  };
  const handleRowBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }

    onThreadFocus(null);
    onThreadIntent(null);
  };

  return {
    handleRowBlurCapture,
    handleRowClick,
    handleRowFocusCapture,
    handleRowKeyDown,
    handleRowMouseDown,
  };
};

type MessageRowSurfaceProps = {
  activeMailbox: MessageListProps["activeMailbox"];
  anchorMessage: ThreadListEntry["anchorMessage"];
  date: string;
  gmailLabels: MailboxLabel[];
  isActionPending: boolean;
  isActive: boolean;
  isDraftMailbox: boolean;
  isPressed: boolean;
  isSelected: boolean;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxId: string;
  mailboxProvider: MessageListProps["mailboxProvider"];
  metaTextClassName: string;
  onKeyboardOpen?: () => void;
  onOpenDraft: MessageListProps["onOpenDraft"];
  onThreadFocus: (threadId: string | null) => void;
  onThreadIntent: (threadId: string | null) => void;
  onThreadPress: MessageRowProps["onThreadPress"];
  onThreadSelectionPress: MessageRowProps["onThreadSelectionPress"];
  openAriaLabel: string;
  reducedMotion: boolean | null;
  selectionAriaLabel: string;
  senderInitial: string;
  senderEmail: string;
  senderLabel: string;
  surfaceOpacity: number;
  setIsHovered: (hovered: boolean) => void;
  setIsPressed: (pressed: boolean) => void;
  setIsSelectHovered: (hovered: boolean) => void;
  showCheckbox: boolean;
  showSelectionControl: boolean;
  subject: string;
  thread: ThreadListEntry;
  threaded: boolean;
  unread: boolean;
};

const MessageRowSurface = ({
  activeMailbox,
  anchorMessage,
  date,
  gmailLabels,
  isActionPending,
  isActive,
  isDraftMailbox,
  isPressed,
  isSelected,
  mailboxActions,
  mailboxId,
  mailboxProvider,
  metaTextClassName,
  onKeyboardOpen,
  onOpenDraft,
  onThreadFocus,
  onThreadIntent,
  onThreadPress,
  onThreadSelectionPress,
  openAriaLabel,
  reducedMotion,
  selectionAriaLabel,
  senderInitial,
  senderEmail,
  senderLabel,
  surfaceOpacity,
  setIsHovered,
  setIsPressed,
  setIsSelectHovered,
  showCheckbox,
  showSelectionControl,
  subject,
  thread,
  threaded,
  unread,
}: MessageRowSurfaceProps) => {
  const {
    handleRowBlurCapture,
    handleRowClick,
    handleRowFocusCapture,
    handleRowKeyDown,
    handleRowMouseDown,
  } = useMessageRowHandlers({
    isActionPending,
    isActive,
    mailboxActions,
    mailboxProvider,
    onKeyboardOpen,
    onThreadFocus,
    onThreadIntent,
    onThreadPress,
    onThreadSelectionPress,
    showSelectionControl,
    thread,
    unread,
  });

  return (
    <m.div
      animate={{
        scale: reducedMotion !== false || !isPressed ? 1 : 0.97,
      }}
      className="relative flex h-17 items-stretch rounded-lg"
      initial={false}
      onBlurCapture={handleRowBlurCapture}
      onFocusCapture={handleRowFocusCapture}
      onMouseEnter={() => {
        setIsHovered(true);
        onThreadIntent(thread.threadId);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onThreadIntent(null);
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse") {
          return;
        }

        onThreadFocus(null);
        const active = document.activeElement;
        if (
          active instanceof HTMLButtonElement &&
          Object.hasOwn(active.dataset, "messageRowTrigger")
        ) {
          active.blur();
        }
      }}
      transition={rowPressTransition}
    >
      <m.span
        animate={{ opacity: surfaceOpacity }}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 rounded-lg bg-muted"
        initial={false}
        transition={{ duration: appMotionDuration.feedback, ease: appEaseOut }}
      />

      {unread && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-0 z-20 h-8 w-0.75 -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <MessageRowSelectionButton
        isActionPending={isActionPending}
        isSelected={isSelected}
        onThreadSelectionPress={onThreadSelectionPress}
        reducedMotion={reducedMotion}
        selectionAriaLabel={selectionAriaLabel}
        senderInitial={senderInitial}
        setIsSelectHovered={setIsSelectHovered}
        showCheckbox={showCheckbox}
        thread={thread}
      />

      <MessageActionsContextMenu
        actions={createMailboxThreadMessageActionHandlers({
          mailboxActions,
          onOpenDraft,
          supportsArchive: mailboxProvider !== "api",
          supportsFolders: mailboxProvider === "gmail",
          supportsLabels: mailboxProvider !== "api",
          supportsReadState: mailboxProvider !== "api",
          supportsUnsubscribe: mailboxProvider === "gmail",
        })}
        isPending={isActionPending}
        mailboxId={mailboxId}
        mailbox={activeMailbox}
        message={anchorMessage}
        threadLabelIds={thread.threadLabelIds}
        triggerClassName="flex h-full min-w-0 flex-1 active:scale-100"
      >
        <button
          aria-label={openAriaLabel}
          aria-current={isActive ? "true" : undefined}
          className="relative z-10 flex h-full min-w-0 flex-1 items-center rounded-lg border border-transparent text-left focus-visible:z-20 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
          data-message-row-trigger
          onClick={handleRowClick}
          onKeyDown={handleRowKeyDown}
          onMouseDown={handleRowMouseDown}
          onPointerCancel={() => {
            setIsPressed(false);
          }}
          onPointerDown={() => {
            setIsPressed(true);
          }}
          onPointerLeave={() => {
            setIsPressed(false);
          }}
          onPointerUp={() => {
            setIsPressed(false);
          }}
          type="button"
        >
          <MessageRowDetails
            date={date}
            gmailLabels={gmailLabels}
            isDraftMailbox={isDraftMailbox}
            metaTextClassName={metaTextClassName}
            senderEmail={senderEmail}
            senderLabel={senderLabel}
            subject={subject}
            thread={thread}
            threaded={threaded}
            unread={unread}
          />
        </button>
      </MessageActionsContextMenu>
    </m.div>
  );
};

const MessageRowContent = ({
  activeMailbox,
  gmailLabels,
  mailboxActions,
  mailboxId,
  mailboxProvider,
  onOpenDraft,
  onKeyboardOpen,
  onThreadFocus,
  onThreadIntent,
  onThreadPress,
  onThreadSelectionPress,
  pendingActions,
  state,
  thread,
}: MessageRowContentProps) => {
  const reducedMotion = useReducedMotion();
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isSelectHovered, setIsSelectHovered] = useState(false);
  const isActive = state?.active === true;
  const isSelected = state?.selected === true;
  const showSelectionControl = state?.selectionMode === true;
  const showCheckbox = showSelectionControl || isSelectHovered;
  const { anchorMessage } = thread;
  const isDraftMailbox = activeMailbox === "drafts";
  const subject = getMessageRowSubject(anchorMessage);
  const { senderEmail, senderInitial, senderLabel } = getMessageRowSender(
    anchorMessage,
    isDraftMailbox
  );
  const date = formatMessageListDate(anchorMessage);
  const unread = !isDraftMailbox && thread.unreadCount > 0;
  const threaded = thread.messageCount > 1;
  const isActionPending =
    pendingActions.isMessageActionPending(anchorMessage.id) ||
    pendingActions.isThreadActionPending(thread.threadId);
  const metaTextClassName = cn("text-xs tabular-nums", {
    "font-semibold text-fg/90": unread,
    "text-fg/75": isActive && !unread,
    "text-muted-fg": !unread,
  });
  const surfaceOpacity = getMessageRowSurfaceOpacity(
    isActive,
    isHovered,
    isSelected
  );
  const selectionAriaLabel = isDraftMailbox
    ? "Select draft"
    : "Select conversation";
  const openAriaLabel = getMessageRowOpenAriaLabel(
    isActive,
    isDraftMailbox,
    subject
  );
  return (
    <MessageRowSurface
      activeMailbox={activeMailbox}
      anchorMessage={anchorMessage}
      date={date}
      gmailLabels={gmailLabels}
      isActionPending={isActionPending}
      isActive={isActive}
      isDraftMailbox={isDraftMailbox}
      isPressed={isPressed}
      isSelected={isSelected}
      mailboxActions={mailboxActions}
      mailboxId={mailboxId}
      mailboxProvider={mailboxProvider}
      metaTextClassName={metaTextClassName}
      onKeyboardOpen={onKeyboardOpen}
      onOpenDraft={onOpenDraft}
      onThreadFocus={onThreadFocus}
      onThreadIntent={onThreadIntent}
      onThreadPress={onThreadPress}
      onThreadSelectionPress={onThreadSelectionPress}
      openAriaLabel={openAriaLabel}
      reducedMotion={reducedMotion}
      selectionAriaLabel={selectionAriaLabel}
      senderEmail={senderEmail}
      senderInitial={senderInitial}
      senderLabel={senderLabel}
      surfaceOpacity={surfaceOpacity}
      setIsHovered={setIsHovered}
      setIsPressed={setIsPressed}
      setIsSelectHovered={setIsSelectHovered}
      showCheckbox={showCheckbox}
      showSelectionControl={showSelectionControl}
      subject={subject}
      thread={thread}
      threaded={threaded}
      unread={unread}
    />
  );
};

export const MessageRow = ({
  activeMailbox,
  className,
  dataIndex,
  gmailLabels,
  mailboxActions,
  mailboxId,
  mailboxProvider,
  offsetY,
  onKeyboardOpen,
  onOpenDraft,
  onThreadFocus,
  onThreadIntent,
  onThreadPress,
  onThreadSelectionPress,
  pendingActions,
  rowRef,
  state,
  thread,
  isNew,
  staggerIndex = 0,
}: MessageRowProps) => {
  const shouldReduceMotion = useReducedMotion();

  const element = (
    <MessageRowContent
      activeMailbox={activeMailbox}
      gmailLabels={gmailLabels}
      mailboxActions={mailboxActions}
      mailboxId={mailboxId}
      mailboxProvider={mailboxProvider}
      onOpenDraft={onOpenDraft}
      onKeyboardOpen={onKeyboardOpen}
      onThreadFocus={onThreadFocus}
      onThreadIntent={onThreadIntent}
      onThreadPress={onThreadPress}
      onThreadSelectionPress={onThreadSelectionPress}
      pendingActions={pendingActions}
      state={state}
      thread={thread}
    />
  );

  return (
    <li
      className={cn("relative", className)}
      data-index={dataIndex}
      data-thread-id={thread.threadId}
      ref={rowRef}
      style={{
        transform: `translateY(${offsetY}px)`,
      }}
    >
      {isNew === true ? (
        <m.div
          animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
          initial={
            shouldReduceMotion === true
              ? { opacity: 0 }
              : { opacity: 0, transform: "translate3d(0, -8px, 0)" }
          }
          transition={{
            delay:
              shouldReduceMotion === true
                ? 0
                : getAppStaggerDelay(staggerIndex),
            duration:
              shouldReduceMotion === true
                ? appMotionDuration.feedback
                : appMotionDuration.enter,
            ease: appEaseOut,
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
