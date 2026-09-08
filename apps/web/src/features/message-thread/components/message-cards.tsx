"use client";

import {
  ArrowDown01Icon,
  ArrowRightDoubleIcon,
  Edit01Icon,
  MailReply02Icon,
  MailReplyAll02Icon,
  NotificationOff01Icon,
  ZoomInAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { TooltipGroup } from "@quieter/ui/tooltip";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { SenderAvatar } from "#/components/sender-avatar";
import {
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "#/features/compose/domain/compose-actions";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { GmailUsefulDetailCard } from "#/features/gmail-useful-details/components/gmail-useful-detail-card";
import type { GmailUsefulDetail } from "#/features/gmail-useful-details/components/gmail-useful-detail-card";
import { MessageDeliveryStatus } from "#/features/message-delivery/components/message-delivery-status";
import { supportsMessageDelivery } from "#/features/message-delivery/domain/message-delivery-support";
import { formatMessageDate, parseSender } from "#/lib/gmail/message-utils";
import { isMessageUnread } from "#/lib/mail";
import type { MessageListItem } from "#/lib/mail";

import { MessageBody } from "./message-body";
import { MessageInspectorPanel } from "./message-inspector-panel";
import {
  getMessageUnsubscribeTarget,
  openUnsubscribeUrl,
} from "./message-unsubscribe";
import type { MessageUnsubscribeTarget } from "./message-unsubscribe";
import type { MessageViewProps } from "./message-view-types";

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
  onClick: () => void;
};

const formatEnvelopeValue = (value?: string) => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

const getMessageUnsubscribeAction = (
  message: MessageListItem,
  onUnsubscribe?: (messageId: string) => void | Promise<void>
): MessageUnsubscribeAction | undefined => {
  const target = getMessageUnsubscribeTarget(message);
  if (!target) {
    return undefined;
  }

  if (target.kind === "mailto") {
    if (!onUnsubscribe) {
      return undefined;
    }

    return {
      kind: "mailto",
      onClick: () => {
        void onUnsubscribe(message.id);
      },
    };
  }

  return {
    kind: "url",
    onClick: () => {
      openUnsubscribeUrl(target.url);
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
          className="size-10"
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
  expanded,
  onContinueDraft,
  onDetails,
  onForward,
  onReply,
  onReplyAll,
  onUnsubscribe,
  isPending,
  showReplyAll = true,
}: {
  className?: string;
  expanded?: boolean;
  isPending?: boolean;
  onContinueDraft?: () => void;
  onDetails: () => void;
  onForward: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onUnsubscribe?: MessageUnsubscribeAction;
  showReplyAll?: boolean;
}) => {
  const handleUnsubscribe = () => {
    onUnsubscribe?.onClick();
  };

  return (
    <AnimatePresence>
      {expanded !== false && (
        <m.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10 }}
          transition={{ duration: 0.2, ease: [0.2, 1, 0.4, 1] }}
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
              <HugeiconsIcon aria-hidden icon={Edit01Icon} />
              <span>Draft</span>
            </Button>
          )}
          <Button onClick={onReply} size="sm" type="button" variant="ghost">
            <HugeiconsIcon aria-hidden icon={MailReply02Icon} />
            <span>Reply</span>
          </Button>
          {showReplyAll && (
            <Button
              onClick={onReplyAll}
              size="sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={MailReplyAll02Icon} />
              <span>Reply all</span>
            </Button>
          )}
          <Button onClick={onForward} size="sm" type="button" variant="ghost">
            <HugeiconsIcon aria-hidden icon={ArrowRightDoubleIcon} />
            <span>Forward</span>
          </Button>
          {onUnsubscribe !== undefined && (
            <IconButtonTooltip label="Unsubscribe">
              <Button
                aria-label="Unsubscribe"
                disabled={isPending === true && onUnsubscribe.kind === "mailto"}
                onClick={handleUnsubscribe}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon aria-hidden icon={NotificationOff01Icon} />
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
              <HugeiconsIcon aria-hidden icon={ZoomInAreaIcon} />
            </Button>
          </IconButtonTooltip>
        </m.div>
      )}
    </AnimatePresence>
  );
};

const ThreadMessageBody = ({
  expanded,
  isLoading,
  message,
}: {
  expanded: boolean;
  isLoading?: boolean;
  message: MessageListItem;
}) => (
  <div
    aria-hidden={!expanded}
    className="grid overflow-hidden transition-[grid-template-rows] duration-(--app-motion-duration-layout) ease-(--app-motion-ease-in-out) motion-reduce:transition-none"
    style={{
      gridTemplateRows: expanded ? "1fr" : "0fr",
      pointerEvents: expanded ? "auto" : "none",
    }}
  >
    <div className="min-h-0 overflow-hidden">
      <div
        className={cn(
          "px-4 pb-4 transition-[opacity,transform] duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out) motion-reduce:transition-none @sm:px-5 @sm:pb-5",
          {
            "-translate-y-1 opacity-0": !expanded,
            "translate-y-0 opacity-100": expanded,
          }
        )}
      >
        <MessageBody
          html={message.bodyHtml}
          isLoading={isLoading}
          text={message.bodyText}
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
      className={cn("text-muted-fg hover:text-fg", {
        "text-fg/80": expanded,
      })}
      onClick={onToggleExpanded}
      size="icon-sm"
      variant="ghost"
    >
      <HugeiconsIcon
        aria-hidden
        className={cn(
          "transition-transform duration-(--app-motion-duration-layout) ease-(--app-motion-ease-in-out) motion-reduce:transition-none",
          {
            "rotate-180": expanded,
          }
        )}
        icon={ArrowDown01Icon}
      />
    </Button>
  </IconButtonTooltip>
);

const ThreadMessageCard = ({
  currentUserEmail,
  expanded,
  isLoading,
  linkedDraftMessage,
  mailboxId,
  mailboxProvider,
  message,
  onComposeDraftRequested,
  onUnsubscribe,
  onToggleExpanded,
  isActionPending,
  usefulDetails,
}: {
  currentUserEmail?: string | null;
  expanded: boolean;
  isLoading?: boolean;
  isActionPending?: boolean;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onToggleExpanded: () => void;
  usefulDetails: GmailUsefulDetail[];
}) => {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const showsDelivery = supportsMessageDelivery({
    mailboxId,
    mailboxProvider,
    message,
  });

  const openComposeAction = (action: "reply" | "reply-all" | "forward") => {
    if (!onComposeDraftRequested) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        existingDraftMessage: linkedDraftMessage,
        message,
      })
    );
  };

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
      <section className={cn("transition-colors duration-200")}>
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
              expanded={expanded}
              onContinueDraft={linkedDraftMessage ? openLinkedDraft : undefined}
              onDetails={() => {
                setDetailsDialogOpen(true);
              }}
              onForward={() => {
                openComposeAction("forward");
              }}
              isPending={isActionPending}
              onReply={() => {
                openComposeAction("reply");
              }}
              onReplyAll={() => {
                openComposeAction("reply-all");
              }}
              onUnsubscribe={getMessageUnsubscribeAction(
                message,
                onUnsubscribe
              )}
              showReplyAll={hasDistinctReplyAllRecipients(
                message,
                currentUserEmail
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

        {usefulDetails.length > 0 && (
          <div className="space-y-1.5 px-4 pb-3 @sm:px-5">
            {usefulDetails.map((detail) => (
              <GmailUsefulDetailCard
                detail={detail}
                key={detail.id}
                mailboxId={mailboxId}
              />
            ))}
          </div>
        )}

        <div id={`message-body-${message.id}`}>
          <ThreadMessageBody
            expanded={expanded}
            isLoading={isLoading}
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
  currentUserEmail,
  isLoading,
  linkedDraftMessage,
  mailboxId,
  mailboxProvider,
  message,
  onComposeDraftRequested,
  onUnsubscribe,
  isActionPending,
  usefulDetails,
}: {
  currentUserEmail?: string | null;
  isLoading?: boolean;
  isActionPending?: boolean;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  usefulDetails: GmailUsefulDetail[];
}) => {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const showsDelivery = supportsMessageDelivery({
    mailboxId,
    mailboxProvider,
    message,
  });

  const openComposeAction = (action: "reply" | "reply-all" | "forward") => {
    if (!onComposeDraftRequested) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        existingDraftMessage: linkedDraftMessage,
        message,
      })
    );
  };

  const openLinkedDraft = () => {
    if (!onComposeDraftRequested || !linkedDraftMessage) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromSavedDraftMessage(linkedDraftMessage)
    );
  };

  return (
    <section>
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
            onContinueDraft={linkedDraftMessage ? openLinkedDraft : undefined}
            onDetails={() => {
              setDetailsDialogOpen(true);
            }}
            onForward={() => {
              openComposeAction("forward");
            }}
            isPending={isActionPending}
            onReply={() => {
              openComposeAction("reply");
            }}
            onReplyAll={() => {
              openComposeAction("reply-all");
            }}
            onUnsubscribe={getMessageUnsubscribeAction(message, onUnsubscribe)}
            showReplyAll={hasDistinctReplyAllRecipients(
              message,
              currentUserEmail
            )}
          />
        }
        message={message}
        senderNameClassName="text-body-lg"
      />

      {usefulDetails.length > 0 && (
        <div className="space-y-1.5 px-4 pb-3 @sm:px-5">
          {usefulDetails.map((detail) => (
            <GmailUsefulDetailCard
              detail={detail}
              key={detail.id}
              mailboxId={mailboxId}
            />
          ))}
        </div>
      )}

      <div className="px-4 pb-4 @sm:px-5 @sm:pb-5">
        <MessageBody
          html={message.bodyHtml}
          isLoading={isLoading}
          text={message.bodyText}
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
  currentUserEmail,
  isLoading,
  mailboxId,
  mailboxProvider,
  messages,
  onComposeDraftRequested,
  onUnsubscribe,
  isActionPending,
  usefulDetails,
}: {
  allThreadMessages: MessageListItem[];
  currentUserEmail?: string | null;
  isLoading?: boolean;
  isActionPending?: boolean;
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  messages: MessageListItem[];
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  usefulDetails: GmailUsefulDetail[];
}) => {
  const [expandedMessageIds, setExpandedMessageIds] = useState<string[]>(
    messages.length ? [messages[0].id] : []
  );
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
            currentUserEmail={currentUserEmail}
            expanded={isExpanded}
            isLoading={isLoading}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={linkedDraftMessage}
            mailboxId={mailboxId}
            mailboxProvider={mailboxProvider}
            message={threadMessage}
            onComposeDraftRequested={onComposeDraftRequested}
            onUnsubscribe={onUnsubscribe}
            onToggleExpanded={() => {
              setExpandedMessageIds((current) =>
                isExpanded
                  ? current.filter((id) => id !== threadMessage.id)
                  : [...current, threadMessage.id]
              );
            }}
            usefulDetails={usefulDetails.filter(
              (detail) => detail.gmailMessageId === threadMessage.id
            )}
          />
        );
      })}
    </div>
  );
};
