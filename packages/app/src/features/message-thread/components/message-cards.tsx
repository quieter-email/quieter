"use client";

import {
  ArrowDown01Icon,
  Edit01Icon,
  NotificationOff01Icon,
  Flag01Icon,
  FlagOffIcon,
  Tick01Icon,
  ZoomInAreaIcon,
} from "@hugeicons/core-free-icons";
import {
  buildComposeDraftFromSavedDraftMessage,
  findLinkedDraftForMessage,
} from "@quieter/app/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { MessageDeliveryStatus } from "@quieter/app/features/message-delivery/components/message-delivery-status";
import { supportsMessageDelivery } from "@quieter/app/features/message-delivery/domain/message-delivery-support";
import { MessageBody } from "@quieter/app/features/message-thread/components/message-body";
import { MessageInspectorPanel } from "@quieter/app/features/message-thread/components/message-inspector-panel";
import {
  getMessageUnsubscribeTarget,
  messageUnsubscribeLabels,
  openUnsubscribeUrl,
} from "@quieter/app/features/message-thread/components/message-unsubscribe";
import type { MessageUnsubscribeTarget } from "@quieter/app/features/message-thread/components/message-unsubscribe";
import type { MessageViewProps } from "@quieter/app/features/message-thread/components/message-view-types";
import { CopyVerificationCode } from "@quieter/app/features/verification-codes/components/copy-verification-code";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  formatMessageDate,
  parseSender,
} from "@quieter/app/lib/gmail/message-utils";
import { isMessageUnread, MAILBOX_LABELS } from "@quieter/app/lib/mail";
import type { MessageListItem } from "@quieter/app/lib/mail";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { SenderAvatar } from "@quieter/ui/sender-avatar";
import { TooltipGroup } from "@quieter/ui/tooltip";
import { domAnimation, LazyMotion } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";

type MessageHeaderContentProps = {
  message: MessageListItem;
  className?: string;
  deliveryStatus?: ReactNode;
  headerActions?: ReactNode;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  previewMode?: "none" | "collapsed";
  senderNameClassName?: string;
  trailing?: ReactNode;
};

type MessageUnsubscribeAction = {
  kind: MessageUnsubscribeTarget["kind"];
  onClick: () => Promise<boolean>;
};

const formatEnvelopeValue = (value?: string) => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

const getMessageUnsubscribeAction = (
  message: MessageListItem,
  onUnsubscribe?: (messageId: string) => Promise<boolean>
): MessageUnsubscribeAction | undefined => {
  const target = getMessageUnsubscribeTarget(message);
  if (!target) {
    return undefined;
  }

  if (target.kind !== "url") {
    if (!onUnsubscribe) {
      return undefined;
    }

    return {
      kind: target.kind,
      onClick: async () => await onUnsubscribe(message.id),
    };
  }

  return {
    kind: "url",
    onClick: async () => {
      openUnsubscribeUrl(target.url);
      await Promise.resolve();
      return false;
    },
  };
};

const MessageHeaderContent = ({
  className,
  deliveryStatus,
  headerActions,
  isExpanded,
  message,
  onToggleExpanded,
  previewMode,
  senderNameClassName,
  trailing,
}: MessageHeaderContentProps) => {
  const sender = parseSender(message.from);
  const senderDisplayName = sender.name?.trim() ?? "";
  const senderName =
    senderDisplayName === ""
      ? (sender.display ?? "Unknown sender")
      : (sender.name ?? senderDisplayName);
  const senderEmail = sender.email?.trim() ?? "";
  const senderInitial = (senderName.trim().charAt(0) || "?").toUpperCase();
  const date = formatMessageDate(message, "full") ?? "--";
  const preview = message.snippet?.trim() ?? "";
  const participantRows = [
    { label: "To", value: formatEnvelopeValue(message.to) },
  ].filter((row) => (row.value ?? "") !== "");
  /* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions -- header text only stops click bubbling so selecting sender, date, or preview does not toggle the collapsed message. */
  const content = (
    <div className="w-full min-w-0 flex-1 select-text">
      <div className="flex w-full min-w-0 flex-wrap items-baseline justify-start gap-x-2 gap-y-1">
        {isMessageUnread(message) && (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-fg/75" />
        )}

        <span
          className={cn(
            "max-w-full min-w-0 shrink cursor-text truncate text-body font-medium text-fg",
            senderNameClassName
          )}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {senderName}
        </span>

        {senderEmail !== "" && (
          <span
            className="max-w-full min-w-0 shrink cursor-text truncate text-caption text-muted-fg @sm:text-body"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {senderEmail}
          </span>
        )}

        <span
          className="shrink-0 basis-full cursor-text text-caption whitespace-nowrap text-muted-fg @sm:basis-auto @sm:text-body"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {date}
        </span>

        {deliveryStatus}
      </div>

      {previewMode === "collapsed" && isExpanded === false ? (
        <p
          className="mt-1 min-h-5 cursor-text truncate text-body text-fg"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {preview === "" ? <span aria-hidden>&nbsp;</span> : preview}
        </p>
      ) : (
        <div className="mt-1 min-h-5 space-y-1">
          {participantRows.map((row) => (
            <div
              className="flex min-w-0 items-start gap-2 text-caption @sm:text-body"
              key={row.label}
            >
              <span
                className="shrink-0 cursor-text text-muted-fg"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {row.label}
              </span>
              <span
                className="min-w-0 cursor-text wrap-break-word text-fg"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  /* oxlint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions */

  return (
    <div className={cn("flex items-start gap-4", className)}>
      <div className="mt-0.5 shrink-0">
        <SenderAvatar
          avatarUrlDark={message.senderAvatarUrls?.dark}
          avatarUrlLight={message.senderAvatarUrls?.light}
          size="sm"
          fallbackLabel={senderInitial}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
          {onToggleExpanded ? (
            <button
              aria-controls={`message-body-${message.id}`}
              aria-expanded={isExpanded}
              className="w-full min-w-0 rounded-sm text-left transition-colors select-text @sm:flex-1"
              onClick={(event) => {
                const selection = window.getSelection();
                if (
                  selection &&
                  !selection.isCollapsed &&
                  (selection.toString().trim() ?? "") !== ""
                ) {
                  for (
                    let index = 0;
                    index < selection.rangeCount;
                    index += 1
                  ) {
                    if (
                      selection
                        .getRangeAt(index)
                        .intersectsNode(event.currentTarget)
                    ) {
                      return;
                    }
                  }
                }

                onToggleExpanded();
              }}
              type="button"
            >
              {content}
            </button>
          ) : (
            <div className="w-full min-w-0 @sm:flex-1">{content}</div>
          )}

          <TooltipGroup>
            <div className="flex min-w-0 flex-wrap items-center justify-start gap-1 gap-y-2 @sm:w-auto @sm:justify-end @sm:pl-4">
              {headerActions}
              {trailing}
            </div>
          </TooltipGroup>
        </div>
      </div>
    </div>
  );
};

const MessageHeaderActions = ({
  className,
  onContinueDraft,
  onDetails,
  onUnsubscribe,
  onSetImportance,
  message,
  isPending,
}: {
  className?: string;
  isPending?: boolean;
  onContinueDraft?: () => void;
  onDetails: () => void;
  onUnsubscribe?: MessageUnsubscribeAction;
  message: MessageListItem;
  onSetImportance?: (messageId: string, important: boolean) => Promise<void>;
}) => {
  const [unsubscribePhase, setUnsubscribePhase] = useState<
    "idle" | "pending" | "success"
  >("idle");
  const unsubscribeRequested =
    message.unsubscribeStatus === "requested" || unsubscribePhase === "success";
  let unsubscribeLabel: string =
    messageUnsubscribeLabels[onUnsubscribe?.kind ?? "mailto"];
  if (unsubscribeRequested) {
    unsubscribeLabel = "Unsubscribe requested";
  }
  const handleUnsubscribe = async () => {
    if (!onUnsubscribe || unsubscribePhase !== "idle" || unsubscribeRequested) {
      return;
    }
    setUnsubscribePhase("pending");
    try {
      setUnsubscribePhase((await onUnsubscribe.onClick()) ? "success" : "idle");
    } catch (error) {
      toastError(error, { boundary: "unsubscribe" });
      setUnsubscribePhase("idle");
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-start gap-1 @md:justify-end",
        className
      )}
    >
      {onContinueDraft !== undefined && (
        <Button
          onClick={onContinueDraft}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden icon={Edit01Icon} />
          <span>Draft</span>
        </Button>
      )}
      {onSetImportance !== undefined &&
        !(
          message.labelIds?.some(
            (id) => id === MAILBOX_LABELS.sent || id === MAILBOX_LABELS.drafts
          ) ?? false
        ) && (
          <IconButtonTooltip
            label={
              message.isImportant === true
                ? "Mark message as not important"
                : "Mark message as important"
            }
          >
            <Button
              aria-label={
                message.isImportant === true
                  ? "Mark message as not important"
                  : "Mark message as important"
              }
              aria-pressed={message.isImportant === true}
              disabled={isPending}
              onClick={() => {
                void onSetImportance(message.id, message.isImportant !== true);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Icon
                aria-hidden
                icon={message.isImportant === true ? Flag01Icon : FlagOffIcon}
                tone={message.isImportant === true ? "default" : "muted"}
              />
            </Button>
          </IconButtonTooltip>
        )}
      {(onUnsubscribe !== undefined ||
        unsubscribePhase !== "idle" ||
        unsubscribeRequested) && (
        <IconButtonTooltip label={unsubscribeLabel}>
          <Button
            aria-label={unsubscribeLabel}
            disabled={
              unsubscribeRequested ||
              (isPending === true && onUnsubscribe?.kind !== "url")
            }
            onClick={() => {
              void handleUnsubscribe();
            }}
            size="icon-sm"
            pending={unsubscribePhase === "pending"}
            type="button"
            variant="ghost"
          >
            <Icon
              aria-hidden
              icon={unsubscribeRequested ? Tick01Icon : NotificationOff01Icon}
              tone={unsubscribeRequested ? "success" : undefined}
            />
          </Button>
        </IconButtonTooltip>
      )}
      <IconButtonTooltip label="Details">
        <Button
          aria-label="Details"
          onClick={onDetails}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden icon={ZoomInAreaIcon} />
        </Button>
      </IconButtonTooltip>
    </div>
  );
};

const ThreadMessageBody = ({
  expanded,
  isLoading,
  mailboxId,
  message,
}: {
  expanded: boolean;
  isLoading?: boolean;
  mailboxId: string;
  message: MessageListItem;
}) => (
  <div
    aria-hidden={!expanded}
    // oxlint-disable-next-line shadcn/no-arbitrary-values -- Grid-rows collapse animation needs the exact property.
    className="grid overflow-hidden transition-[grid-template-rows] duration-(--app-motion-duration-layout) ease-(--app-motion-ease-in-out) motion-reduce:transition-none"
    style={{
      // oxlint-disable-next-line shadcn/no-inline-styles -- Collapse animation is driven by measured state.
      gridTemplateRows: expanded ? "1fr" : "0fr",
      // oxlint-disable-next-line shadcn/no-inline-styles -- Collapse animation is driven by measured state.
      pointerEvents: expanded ? "auto" : "none",
    }}
  >
    <div className="min-h-0 overflow-hidden">
      <div
        className={cn(
          // oxlint-disable-next-line shadcn/no-arbitrary-values -- Enter animation needs the exact property list.
          "mx-auto w-full max-w-3xl px-4 pb-4 transition-[opacity,transform] duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out) motion-reduce:transition-none @sm:px-5 @sm:pb-5",
          {
            "-translate-y-1 opacity-0": !expanded,
            "translate-y-0 opacity-100": expanded,
          }
        )}
      >
        <MessageBody
          isLoading={isLoading}
          mailboxId={mailboxId}
          message={message}
        />
      </div>
    </div>
  </div>
);

const MessageExpandButton = ({
  expanded,
  messageId,
  onToggleExpanded,
}: {
  expanded: boolean;
  messageId: string;
  onToggleExpanded: () => void;
}) => (
  <IconButtonTooltip label={expanded ? "Collapse message" : "Expand message"}>
    <Button
      aria-controls={`message-body-${messageId}`}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse message" : "Expand message"}
      onClick={onToggleExpanded}
      size="icon-sm"
      variant="ghost"
    >
      <Icon
        aria-hidden
        className={cn({
          "rotate-180": expanded,
        })}
        icon={ArrowDown01Icon}
      />
    </Button>
  </IconButtonTooltip>
);

const ThreadMessageCard = ({
  expanded,
  isLoading,
  linkedDraftMessage,
  mailboxId,
  mailboxProvider,
  message,
  onComposeDraftRequested,
  onSetImportance,
  onUnsubscribe,
  onToggleExpanded,
  isActionPending,
  verificationCode,
}: {
  expanded: boolean;
  isLoading?: boolean;
  isActionPending?: boolean;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onSetImportance?: (messageId: string, important: boolean) => Promise<void>;
  onUnsubscribe?: (messageId: string) => Promise<boolean>;
  onToggleExpanded: () => void;
  verificationCode?: string;
}) => {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const showsDelivery = supportsMessageDelivery({
    mailboxId,
    mailboxProvider,
    message,
  });

  const openLinkedDraft = () => {
    if (!onComposeDraftRequested || !linkedDraftMessage) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromSavedDraftMessage(linkedDraftMessage)
    );
  };

  return (
    <LazyMotion features={domAnimation}>
      <section className="group/message transition-colors duration-200">
        <MessageHeaderContent
          className="p-4 @sm:px-5 @sm:py-4"
          deliveryStatus={
            showsDelivery ? (
              <MessageDeliveryStatus
                mailboxId={mailboxId}
                messageId={message.id}
              />
            ) : null
          }
          headerActions={
            <MessageHeaderActions
              key={`${mailboxId}:${message.id}`}
              message={message}
              onSetImportance={onSetImportance}
              onContinueDraft={linkedDraftMessage ? openLinkedDraft : undefined}
              onDetails={() => {
                setDetailsDialogOpen(true);
              }}
              isPending={isActionPending}
              onUnsubscribe={getMessageUnsubscribeAction(
                message,
                onUnsubscribe
              )}
            />
          }
          isExpanded={expanded}
          message={message}
          onToggleExpanded={onToggleExpanded}
          previewMode="collapsed"
          trailing={
            <MessageExpandButton
              expanded={expanded}
              messageId={message.id}
              onToggleExpanded={onToggleExpanded}
            />
          }
        />

        <div id={`message-body-${message.id}`}>
          {verificationCode && (
            <div className="px-4 pb-3 @sm:px-5">
              <CopyVerificationCode code={verificationCode} size="default" />
            </div>
          )}
          <ThreadMessageBody
            expanded={expanded}
            isLoading={isLoading}
            mailboxId={mailboxId}
            message={message}
          />
        </div>

        <MessageInspectorPanel
          deliveryEnabled={showsDelivery}
          mailboxId={mailboxId}
          message={message}
          onOpenChange={setDetailsDialogOpen}
          open={detailsDialogOpen}
        />
      </section>
    </LazyMotion>
  );
};

export const SingleMessageCard = ({
  isLoading,
  linkedDraftMessage,
  mailboxId,
  mailboxProvider,
  message,
  onComposeDraftRequested,
  onSetImportance,
  onUnsubscribe,
  isActionPending,
  verificationCode,
}: {
  isLoading?: boolean;
  isActionPending?: boolean;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onSetImportance?: (messageId: string, important: boolean) => Promise<void>;
  onUnsubscribe?: (messageId: string) => Promise<boolean>;
  verificationCode?: string;
}) => {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const showsDelivery = supportsMessageDelivery({
    mailboxId,
    mailboxProvider,
    message,
  });

  const openLinkedDraft = () => {
    if (!onComposeDraftRequested || !linkedDraftMessage) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromSavedDraftMessage(linkedDraftMessage)
    );
  };

  return (
    <section className="group/message">
      <MessageHeaderContent
        className="p-4 @sm:p-5"
        deliveryStatus={
          showsDelivery ? (
            <MessageDeliveryStatus
              mailboxId={mailboxId}
              messageId={message.id}
            />
          ) : null
        }
        headerActions={
          <MessageHeaderActions
            key={`${mailboxId}:${message.id}`}
            message={message}
            onSetImportance={onSetImportance}
            onContinueDraft={linkedDraftMessage ? openLinkedDraft : undefined}
            onDetails={() => {
              setDetailsDialogOpen(true);
            }}
            isPending={isActionPending}
            onUnsubscribe={getMessageUnsubscribeAction(message, onUnsubscribe)}
          />
        }
        message={message}
        senderNameClassName="text-body-lg"
      />

      <div className="mx-auto w-full max-w-3xl px-4 pb-4 @sm:px-5 @sm:pb-5">
        {verificationCode && (
          <div className="pb-3">
            <CopyVerificationCode code={verificationCode} size="default" />
          </div>
        )}
        <MessageBody
          isLoading={isLoading}
          mailboxId={mailboxId}
          message={message}
        />
      </div>

      <MessageInspectorPanel
        deliveryEnabled={showsDelivery}
        mailboxId={mailboxId}
        message={message}
        onOpenChange={setDetailsDialogOpen}
        open={detailsDialogOpen}
      />
    </section>
  );
};

export const ThreadMessageList = ({
  allThreadMessages,
  isLoading,
  mailboxId,
  mailboxProvider,
  messages,
  onComposeDraftRequested,
  onSetImportance,
  onUnsubscribe,
  isActionPending,
  verificationCodes,
}: {
  allThreadMessages: MessageListItem[];
  isLoading?: boolean;
  isActionPending?: boolean;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  messages: MessageListItem[];
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onSetImportance?: (messageId: string, important: boolean) => Promise<void>;
  onUnsubscribe?: (messageId: string) => Promise<boolean>;
  verificationCodes: RouterOutputs["mail"]["listVerificationCodes"]["items"];
}) => {
  const [expandedMessageIds, setExpandedMessageIds] = useState<string[]>(() => {
    const lastMessage = messages.at(-1);
    return lastMessage ? [lastMessage.id] : [];
  });
  const expandedMessageIdSet = new Set(expandedMessageIds);

  return (
    <div>
      {messages.map((threadMessage) => {
        const isExpanded = expandedMessageIdSet.has(threadMessage.id);
        const linkedDraftMessage = findLinkedDraftForMessage(
          allThreadMessages,
          threadMessage
        );

        return (
          <ThreadMessageCard
            expanded={isExpanded}
            isLoading={isLoading}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={linkedDraftMessage}
            mailboxId={mailboxId}
            mailboxProvider={mailboxProvider}
            message={threadMessage}
            onComposeDraftRequested={onComposeDraftRequested}
            onSetImportance={onSetImportance}
            onUnsubscribe={onUnsubscribe}
            onToggleExpanded={() => {
              setExpandedMessageIds((current) =>
                isExpanded
                  ? current.filter((id) => id !== threadMessage.id)
                  : [...current, threadMessage.id]
              );
            }}
            verificationCode={
              verificationCodes.find(
                (item) => item.messageId === threadMessage.id
              )?.code
            }
          />
        );
      })}
    </div>
  );
};
