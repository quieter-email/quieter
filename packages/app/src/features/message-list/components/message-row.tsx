"use client";

import {
  FileAttachmentIcon,
  MessageMultiple01Icon,
} from "@hugeicons/core-free-icons";
import {
  DELIVERY_PILL_TONES,
  getDeliveryStatusLabel,
  getDeliveryStatusTone,
} from "@quieter/app/features/message-delivery/domain/delivery-status";
import type { MessageDeliveryStatus } from "@quieter/app/features/message-delivery/domain/delivery-status";
import { MessageLabels } from "@quieter/app/features/message-labels/components/message-labels";
import type { MessageListProps } from "@quieter/app/features/message-list/components/message-list-types";
import type { useMessageListSelection } from "@quieter/app/features/message-list/components/use-message-list-selection";
import { createMailboxThreadMessageActionHandlers } from "@quieter/app/features/message-thread/components/message-action-handlers";
import { MessageActionsContextMenu } from "@quieter/app/features/message-thread/components/message-actions";
import {
  appEaseOut,
  appMotionDuration,
  getAppStaggerDelay,
} from "@quieter/app/features/motion/app-motion";
import { CopyVerificationCode } from "@quieter/app/features/verification-codes/components/copy-verification-code";
import {
  formatMessageListDate,
  parseSender,
} from "@quieter/app/lib/gmail/message-utils";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import { splitMailAddressList } from "@quieter/mail/compose/schema";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import type { RouterOutputs } from "@quieter/orpc";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import {
  MailListRowDetails,
  MailListRowSelectionMark,
  mailListRowFrameVariants,
  mailListRowParts,
} from "@quieter/ui/mail-list-row";
import { Pill } from "@quieter/ui/pill";
import { SenderAvatar } from "@quieter/ui/sender-avatar";
import { Text } from "@quieter/ui/text";
import { m, useReducedMotion } from "motion/react";
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useState } from "react";

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
  return isHovered ? 0.65 : 0;
};

const getMessageRowOpenAriaLabel = (
  isActive: boolean,
  isDraftMailbox: boolean,
  subject: string,
  mailboxEmailAddress?: string
) => {
  const sourceLabel = mailboxEmailAddress ? `, in ${mailboxEmailAddress}` : "";
  if (isDraftMailbox) {
    return `Open draft: ${subject}${sourceLabel}`;
  }
  return `${isActive ? "Close" : "Open"} conversation: ${subject}${sourceLabel}`;
};

const getMessageRowCountsTitle = (thread: ThreadListEntry) => {
  const parts: string[] = [];
  if (thread.attachmentCount > 0) {
    parts.push(
      thread.attachmentCount === 1
        ? "1 attachment"
        : `${thread.attachmentCount} attachments`
    );
  }
  if (thread.messageCount > 1) {
    parts.push(
      thread.messageCount === 1
        ? "1 message"
        : `${thread.messageCount} messages`
    );
  }
  return `This thread has ${parts.join(" and ")}.`;
};

const rowPressTransition = {
  damping: 28,
  mass: 0.7,
  stiffness: 700,
  type: "spring",
} as const;

type MessageRowProps = {
  wideCompactRows?: boolean;
  activeMailbox: MessageListProps["activeMailbox"];
  badge?: ReactNode;
  deliveryStatus?: MessageDeliveryStatus | null;
  gmailLabels: MailboxLabel[];
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxEmailAddress?: string;
  mailboxDisplayName?: string | null;
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
  verificationCode?: RouterOutputs["mail"]["listVerificationCodes"]["items"][number];
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
    <div className={mailListRowParts.selectionCell}>
      <button
        aria-label={selectionAriaLabel}
        aria-pressed={isSelected}
        className={mailListRowParts.selectionButton}
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
          className="flex items-center justify-center"
          initial={false}
          transition={{
            duration: appMotionDuration.feedback,
            ease: appEaseOut,
          }}
        >
          <SenderAvatar
            avatarUrlDark={thread.anchorMessage.senderAvatarUrls?.dark}
            avatarUrlLight={thread.anchorMessage.senderAvatarUrls?.light}
            size="sm"
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
          <MailListRowSelectionMark selected={isSelected} />
        </m.span>
      </button>
    </div>
  );
};

const MessageRowDetails = ({
  wideCompactRows,
  badge,
  date,
  deliveryStatus,
  gmailLabels,
  isActive,
  isDraftMailbox,
  senderEmail,
  senderLabel,
  subject,
  thread,
  threaded,
  unread,
  verificationCode,
}: {
  badge?: ReactNode;
  date: string;
  deliveryStatus?: MessageDeliveryStatus | null;
  gmailLabels: MailboxLabel[];
  isActive: boolean;
  isDraftMailbox: boolean;
  senderEmail: string;
  senderLabel: string;
  subject: string;
  thread: ThreadListEntry;
  threaded: boolean;
  unread: boolean;
  verificationCode?: string;
  wideCompactRows?: boolean;
}) => (
  <MailListRowDetails
    active={isActive}
    badge={badge}
    layout={wideCompactRows === true ? "adaptive" : "stacked"}
    metadata={
      <>
        {deliveryStatus !== undefined && deliveryStatus !== null && (
          <Pill
            tone={DELIVERY_PILL_TONES[getDeliveryStatusTone(deliveryStatus)]}
          >
            {getDeliveryStatusLabel(deliveryStatus)}
          </Pill>
        )}
        {(thread.attachmentCount > 0 || threaded) && (
          <Pill
            size="xs"
            tone="neutral"
            title={getMessageRowCountsTitle(thread)}
          >
            <span className="inline-flex items-center gap-1 tabular-nums">
              {thread.attachmentCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icon aria-hidden size={12} icon={FileAttachmentIcon} />
                  <span>{thread.attachmentCount}</span>
                </span>
              )}
              {threaded && (
                <span className="inline-flex items-center gap-1">
                  <Icon aria-hidden size={12} icon={MessageMultiple01Icon} />
                  <span>{thread.messageCount}</span>
                </span>
              )}
            </span>
          </Pill>
        )}
      </>
    }
    sender={senderLabel}
    senderEmail={senderEmail}
    senderPrefix={isDraftMailbox ? "To " : undefined}
    subject={
      isDraftMailbox ? (
        <>
          <Text
            as="span"
            className="mr-2"
            size="sm"
            tone="destructive"
            weight="medium"
          >
            Draft
          </Text>
          {subject}
        </>
      ) : (
        subject
      )
    }
    subjectTrailing={
      <>
        {verificationCode && (
          <CopyVerificationCode code={verificationCode} size="xs" />
        )}
        <MessageLabels
          className="hidden @sm:flex"
          compact
          labelIds={thread.threadLabelIds}
          labels={gmailLabels}
          limit={2}
        />
      </>
    }
    timestamp={date || "--"}
    unread={unread}
  />
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
      !isActive &&
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
  wideCompactRows?: boolean;
  activeMailbox: MessageListProps["activeMailbox"];
  anchorMessage: ThreadListEntry["anchorMessage"];
  badge?: ReactNode;
  date: string;
  deliveryStatus?: MessageDeliveryStatus | null;
  gmailLabels: MailboxLabel[];
  isActionPending: boolean;
  isActive: boolean;
  isDraftMailbox: boolean;
  isPressed: boolean;
  isSelected: boolean;
  mailboxActions: MessageListProps["mailboxActions"];
  mailboxId: string;
  mailboxProvider: MessageListProps["mailboxProvider"];
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
  verificationCode?: MessageRowProps["verificationCode"];
};

const MessageRowSurface = ({
  wideCompactRows,
  activeMailbox,
  anchorMessage,
  badge,
  date,
  deliveryStatus,
  gmailLabels,
  isActionPending,
  isActive,
  isDraftMailbox,
  isPressed,
  isSelected,
  mailboxActions,
  mailboxId,
  mailboxProvider,
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
  verificationCode,
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
      className={mailListRowFrameVariants({
        accent: thread.isImportant ? "yellow" : undefined,
        layout: wideCompactRows === true ? "adaptive" : "stacked",
      })}
      initial={false}
      onBlurCapture={handleRowBlurCapture}
      onFocusCapture={handleRowFocusCapture}
      onMouseOver={(event) => {
        const isCopyButton =
          event.target instanceof Element &&
          event.target.closest("[data-verification-code-copy]") !== null;
        setIsHovered(!isCopyButton);
        onThreadIntent(isCopyButton ? null : thread.threadId);
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
        className={mailListRowParts.overlay}
        initial={false}
        transition={{ duration: appMotionDuration.feedback, ease: appEaseOut }}
      />

      {unread && (
        <span aria-hidden className={mailListRowParts.unreadIndicator} />
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

      <div className="relative h-full min-w-0 flex-1">
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
          message={{ ...anchorMessage, threadIsImportant: thread.isImportant }}
          threadLabelIds={thread.threadLabelIds}
          triggerClassName="relative flex h-full min-w-0 flex-1 active:scale-100"
        >
          <button
            aria-label={`${openAriaLabel}${thread.isImportant ? ", Important" : ""}`}
            title={
              badge !== undefined && badge !== null ? openAriaLabel : undefined
            }
            aria-current={isActive ? "true" : undefined}
            className={mailListRowParts.trigger}
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
          />
          <MessageRowDetails
            wideCompactRows={wideCompactRows}
            badge={badge}
            date={date}
            deliveryStatus={deliveryStatus}
            gmailLabels={gmailLabels}
            isActive={isActive}
            isDraftMailbox={isDraftMailbox}
            senderEmail={senderEmail}
            senderLabel={senderLabel}
            subject={subject}
            thread={thread}
            threaded={threaded}
            unread={unread}
            verificationCode={verificationCode?.code}
          />
        </MessageActionsContextMenu>
      </div>
    </m.div>
  );
};

const MessageRowContent = ({
  wideCompactRows,
  activeMailbox,
  badge,
  deliveryStatus,
  gmailLabels,
  mailboxActions,
  mailboxEmailAddress,
  mailboxDisplayName,
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
  verificationCode,
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
    subject,
    mailboxDisplayName?.trim() && mailboxEmailAddress
      ? `${mailboxDisplayName.trim()} <${mailboxEmailAddress}>`
      : mailboxEmailAddress
  );
  return (
    <MessageRowSurface
      wideCompactRows={wideCompactRows}
      activeMailbox={activeMailbox}
      anchorMessage={anchorMessage}
      badge={badge}
      date={date}
      deliveryStatus={deliveryStatus}
      gmailLabels={gmailLabels}
      isActionPending={isActionPending}
      isActive={isActive}
      isDraftMailbox={isDraftMailbox}
      isPressed={isPressed}
      isSelected={isSelected}
      mailboxActions={mailboxActions}
      mailboxId={mailboxId}
      mailboxProvider={mailboxProvider}
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
      verificationCode={verificationCode}
    />
  );
};

export const MessageRow = ({
  wideCompactRows,
  activeMailbox,
  badge,
  className,
  dataIndex,
  deliveryStatus,
  gmailLabels,
  mailboxActions,
  mailboxEmailAddress,
  mailboxDisplayName,
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
  verificationCode,
  isNew,
  staggerIndex = 0,
}: MessageRowProps) => {
  const shouldReduceMotion = useReducedMotion();

  const element = (
    <MessageRowContent
      wideCompactRows={wideCompactRows}
      activeMailbox={activeMailbox}
      badge={badge}
      deliveryStatus={deliveryStatus}
      gmailLabels={gmailLabels}
      mailboxActions={mailboxActions}
      mailboxEmailAddress={mailboxEmailAddress}
      mailboxDisplayName={mailboxDisplayName}
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
      verificationCode={verificationCode}
    />
  );

  return (
    <li
      className={cn("relative", className)}
      data-index={dataIndex}
      data-thread-id={thread.threadId}
      ref={rowRef}
      style={{
        // oxlint-disable-next-line shadcn/no-inline-styles -- Virtualized rows are positioned by measured offset.
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
