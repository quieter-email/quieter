"use client";

import {
  ArrowDown01Icon,
  ArrowRightDoubleIcon,
  Edit01Icon,
  Loading03Icon,
  MailReply02Icon,
  MailReplyAll02Icon,
  NotificationOff01Icon,
  ZoomInAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { toast } from "@quieter/ui/toast";
import { TooltipGroup } from "@quieter/ui/tooltip";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useEffect, useRef, useState } from "react";
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
import {
  omitDisabledHotkeys,
  shouldIgnoreAppShortcut,
} from "#/features/hotkeys/domain/hotkey-guards";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "#/features/mailbox/components/mailbox-action-handlers";
import { MessageDeliverySection } from "#/features/message-delivery/components/message-delivery-section";
import { MessageDeliveryStatus } from "#/features/message-delivery/components/message-delivery-status";
import { supportsMessageDelivery } from "#/features/message-delivery/domain/message-delivery-support";
import { MessageLabels } from "#/features/message-labels/components/message-labels";
import { toastError } from "#/lib/error-toast";
import {
  hasRenderableMessageBody,
  isMessageUnread,
  MAILBOX_LABELS,
} from "#/lib/gmail/gmail";
import type { MailboxCategory, MessageListItem } from "#/lib/gmail/gmail";
import { labelsQueryOptions } from "#/lib/gmail/labels-query";
import { getMessageInspectorOptions } from "#/lib/gmail/message-inspector-query";
import { formatMessageDate, parseSender } from "#/lib/gmail/message-utils";
import { getThreadLabelIds } from "#/lib/gmail/thread-list";
import { getThreadWithDetailsOptions } from "#/lib/gmail/thread-query";
import { gmailThreadUsefulDetailsQueryOptions } from "#/lib/gmail/useful-details-query";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

import { createMailboxThreadMessageActionHandlers } from "./message-action-handlers";
import { MessageActionsDropdown } from "./message-actions";
import { MessageAttachments } from "./message-attachments";
import { MessageBody } from "./message-body";
import {
  getMessageUnsubscribeTarget,
  openUnsubscribeUrl,
} from "./message-unsubscribe";
import type { MessageUnsubscribeTarget } from "./message-unsubscribe";

type MessageViewProps = {
  activeMailbox: MailboxCategory;
  focusOnOpen?: boolean;
  currentUserEmail?: string | null;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  mailboxActions: MailboxActions;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onBackToList?: () => void;
  onAutoFocusComplete?: () => void;
  pendingActions: MailboxPendingActions;
};

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

const isDraftMessage = (message: MessageListItem) =>
  (message.draftId?.trim() ?? "") !== "" ||
  message.labelIds?.includes(MAILBOX_LABELS.drafts) === true;

const getMessagesMissingLoadedBody = (messages: readonly MessageListItem[]) =>
  messages.filter(
    (threadMessage) =>
      (threadMessage.snippet?.trim() ?? "") !== "" &&
      !hasRenderableMessageBody(threadMessage)
  );

const resolveThreadSubject = (
  visibleMessages: MessageListItem[],
  threadDataSubject: string | undefined,
  messageSubject: string | undefined
): string => {
  for (const threadMessage of visibleMessages) {
    const trimmedSubject = threadMessage.subject?.trim() ?? "";
    if (trimmedSubject !== "") {
      return trimmedSubject;
    }
  }

  const trimmedThreadSubject = threadDataSubject?.trim() ?? "";
  if (trimmedThreadSubject !== "") {
    return trimmedThreadSubject;
  }

  const trimmedMessageSubject = messageSubject?.trim() ?? "";
  if (trimmedMessageSubject !== "") {
    return trimmedMessageSubject;
  }

  return "(No subject)";
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

const runHotkeyThreadAction = async (
  action: () => void | Promise<void>,
  successMessage: string
) => {
  try {
    await action();
    toast.success(successMessage);
  } catch (error) {
    toastError(error, {
      boundary: "message-actions",
      fallback: "Could not update message.",
    });
  }
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

const MessageInspectorPanel = ({
  deliveryEnabled,
  mailboxId,
  message,
  open,
  onOpenChange,
}: {
  deliveryEnabled: boolean;
  mailboxId: string;
  message: MessageListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const {
    data: inspector,
    error: inspectorError,
    isError: isInspectorError,
    isPending: isInspectorPending,
  } = useQuery(getMessageInspectorOptions(mailboxId, message.id, open));
  const payloadText =
    inspector?.payload === undefined
      ? ""
      : JSON.stringify(inspector.payload, null, 2);
  let inspectorBody: ReactNode = null;

  if (isInspectorPending) {
    inspectorBody = (
      <div className="flex items-center gap-2 text-body text-muted-fg">
        <HugeiconsIcon
          aria-hidden
          className="animate-spin"
          icon={Loading03Icon}
        />
        <span>Loading message details…</span>
      </div>
    );
  } else if (isInspectorError) {
    inspectorBody = (
      <p className="text-body text-destructive">
        {inspectorError.message ?? "Could not load message details."}
      </p>
    );
  } else if (inspector !== undefined) {
    inspectorBody = (
      <>
        <section className="space-y-2">
          <h3 className="text-body font-semibold text-fg">Summary</h3>
          {[
            { label: "Reference", value: inspector.messageHeaderId },
            { label: "Subject", value: inspector.subject },
            { label: "Date", value: inspector.date },
            { label: "Snippet", value: inspector.snippet },
          ].flatMap((row) =>
            (row.value?.trim() ?? "") === ""
              ? []
              : [
                  <p className="text-body text-fg" key={row.label}>
                    <span className="font-semibold text-fg">{row.label}: </span>
                    <span className="wrap-break-word">{row.value}</span>
                  </p>,
                ]
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-body font-semibold text-fg">Message headers</h3>
          {inspector.headers.map((header) => (
            <p
              className="text-body text-fg"
              key={`${inspector.messageHeaderId}-${header.name}-${header.value}`}
            >
              <span className="font-semibold text-fg">{header.name}: </span>
              <span className="wrap-break-word">{header.value}</span>
            </p>
          ))}
        </section>

        {(inspector.rawText?.trim() ?? "") !== "" && (
          <section className="space-y-2">
            <h3 className="text-body font-semibold text-fg">
              Original message
            </h3>
            <pre className="overflow-x-auto text-body whitespace-pre-wrap text-fg">
              {inspector.rawText}
            </pre>
          </section>
        )}

        {(inspector.raw?.trim() ?? "") !== "" && (
          <section className="space-y-2">
            <h3 className="text-body font-semibold text-fg">Gmail record</h3>
            <pre className="overflow-x-auto text-body break-all whitespace-pre-wrap text-fg">
              {inspector.raw}
            </pre>
          </section>
        )}

        {payloadText !== "" && (
          <section className="space-y-2">
            <h3 className="text-body font-semibold text-fg">
              Message structure
            </h3>
            <pre className="overflow-x-auto text-body whitespace-pre-wrap text-fg">
              {payloadText}
            </pre>
          </section>
        )}
      </>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(92vw,56rem)]">
        <DialogHeader>
          <DialogTitle className="text-body-lg font-bold">
            Full details
          </DialogTitle>
          <DialogDescription className="text-fg">
            Complete information available for this message.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          <MessageDeliverySection
            enabled={deliveryEnabled && open}
            mailboxId={mailboxId}
            messageId={message.id}
          />
          {inspectorBody}
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton>Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

const SingleMessageCard = ({
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

const ThreadMessageList = ({
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

type ApiSourceActionProps = {
  apiSource: MessageListItem["apiSource"];
  isPending: boolean;
  onCreateMailbox: () => void;
};

const ApiSourceAction = ({
  apiSource,
  isPending,
  onCreateMailbox,
}: ApiSourceActionProps) => {
  if (apiSource === null || apiSource === undefined) {
    return null;
  }
  if (apiSource.canCreateMailbox) {
    return (
      <Button
        disabled={isPending}
        onClick={onCreateMailbox}
        size="sm"
        type="button"
        variant="outline"
      >
        {isPending && (
          <HugeiconsIcon
            aria-hidden
            className="size-3.5 animate-spin"
            icon={Loading03Icon}
          />
        )}
        Create mailbox
      </Button>
    );
  }
  if (
    apiSource.senderMailboxId !== null &&
    apiSource.senderMailboxId !== undefined &&
    apiSource.senderMailboxId !== ""
  ) {
    return (
      <span className="squircle rounded-md bg-muted px-2 py-1 text-caption text-muted-fg">
        {apiSource.includedInMailbox
          ? "Included in mailbox"
          : "Mailbox copy disabled"}
      </span>
    );
  }
  return null;
};

const useMessageViewData = ({
  mailboxId,
  mailboxProvider,
  message,
  pendingActions,
}: {
  mailboxId: string;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  message: MessageListItem;
  pendingActions: MailboxPendingActions;
}) => {
  const queryClient = useQueryClient();
  const { data: gmailLabels = [] } = useQuery(
    labelsQueryOptions(mailboxId, mailboxProvider !== "api")
  );
  const {
    data: threadData,
    isFetching: isThreadFetching,
    isPending: isThreadPending,
  } = useQuery({
    // react-doctor-disable-next-line react-doctor/no-event-handler
    ...getThreadWithDetailsOptions(mailboxId, message.threadId),
    placeholderData: {
      messages: [message],
      snippet: message.snippet,
      subject: message.subject,
      threadId: message.threadId,
    },
    refetchInterval: (query) => {
      const thread = query.state.data;
      const missingBodyCount =
        thread === undefined
          ? 0
          : getMessagesMissingLoadedBody(thread.messages).length;
      return thread !== undefined &&
        query.state.dataUpdateCount < 2 &&
        missingBodyCount > 0
        ? 250
        : false;
    },
  });
  const { data: usefulDetails = [] } = useQuery(
    gmailThreadUsefulDetailsQueryOptions(
      mailboxId,
      message.threadId,
      mailboxProvider === "gmail"
    )
  );
  const createApiMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailboxForApiMessage.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "api-mailbox",
        fallback: "Could not create mailbox.",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: ["messages", mailboxId] }),
      ]);
      toast.success("Mailbox created.");
    },
  });
  const threadMessages =
    threadData?.messages !== undefined && threadData.messages.length > 0
      ? threadData.messages.toReversed()
      : [message];
  const threadLabelIds = getThreadLabelIds(threadMessages);
  const messages = threadMessages.filter(
    (threadMessage) => !isDraftMessage(threadMessage)
  );
  const visibleMessages = messages.length > 0 ? messages : [message];
  const messagesMissingLoadedBody =
    getMessagesMissingLoadedBody(visibleMessages);
  const hasMissingLoadedBody = messagesMissingLoadedBody.length > 0;
  const isBodyRefreshPending =
    isThreadPending || isThreadFetching || hasMissingLoadedBody;
  const subject = resolveThreadSubject(
    visibleMessages,
    threadData?.subject,
    message.subject
  );
  const threadIsUnread = visibleMessages.some((entry) =>
    isMessageUnread(entry)
  );
  const isSingleMessageThread = visibleMessages.length === 1;
  const canComposeFromMailbox = mailboxProvider !== "api";
  const { apiSource } = message;
  const threadAttachments = visibleMessages.flatMap((threadMessage) =>
    (threadMessage.attachments ?? []).map((attachment) => ({
      ...attachment,
      messageId: threadMessage.id,
    }))
  );
  const isActionPending =
    pendingActions.isMessageActionPending(message.id) ||
    pendingActions.isThreadActionPending(message.threadId);
  const hotkeyMessage = visibleMessages[0] ?? message;
  const hotkeyLinkedDraftMessage =
    findLinkedDraftForMessage(threadMessages, hotkeyMessage) ?? undefined;

  const apiSourceAction = (
    <ApiSourceAction
      apiSource={apiSource}
      isPending={createApiMailboxMutation.isPending}
      onCreateMailbox={() => {
        createApiMailboxMutation.mutate({
          mailboxId,
          messageId: message.id,
        });
      }}
    />
  );

  return {
    apiSource,
    apiSourceAction,
    canComposeFromMailbox,
    gmailLabels,
    hotkeyLinkedDraftMessage,
    hotkeyMessage,
    isActionPending,
    isBodyRefreshPending,
    isSingleMessageThread,
    subject,
    threadAttachments,
    threadIsUnread,
    threadLabelIds,
    threadMessages,
    usefulDetails,
    visibleMessages,
  };
};

const useMessageViewHotkeys = ({
  activeMailbox,
  canComposeFromMailbox,
  currentUserEmail,
  hotkeyLinkedDraftMessage,
  hotkeyMessage,
  isActionPending,
  mailboxActions,
  mailboxProvider,
  onBackToList,
  onComposeDraftRequested,
}: {
  activeMailbox: MailboxCategory;
  canComposeFromMailbox: boolean;
  currentUserEmail?: string | null;
  hotkeyLinkedDraftMessage: MessageListItem | undefined;
  hotkeyMessage: MessageListItem;
  isActionPending: boolean;
  mailboxActions: MailboxActions;
  mailboxProvider: MessageViewProps["mailboxProvider"];
  onBackToList?: () => void;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
}) => {
  const requestComposeAction = (action: "reply" | "reply-all" | "forward") => {
    if (!canComposeFromMailbox || onComposeDraftRequested === undefined) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        existingDraftMessage: hotkeyLinkedDraftMessage,
        message: hotkeyMessage,
      })
    );
  };
  useHotkeys(
    omitDisabledHotkeys([
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          requestComposeAction("reply");
        },
        hotkey: "R",
        options: {
          enabled:
            canComposeFromMailbox &&
            onComposeDraftRequested !== undefined &&
            activeMailbox !== "drafts",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          requestComposeAction("reply-all");
        },
        hotkey: "A",
        options: {
          enabled:
            onComposeDraftRequested !== undefined &&
            canComposeFromMailbox &&
            activeMailbox !== "drafts" &&
            hasDistinctReplyAllRecipients(hotkeyMessage, currentUserEmail),
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          requestComposeAction("forward");
        },
        hotkey: "F",
        options: {
          enabled:
            canComposeFromMailbox &&
            onComposeDraftRequested !== undefined &&
            activeMailbox !== "drafts",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.archiveThread(hotkeyMessage.threadId);
            onBackToList?.();
          }, "Conversation archived.");
        },
        hotkey: "E",
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider !== "api" &&
            (activeMailbox === "inbox" || activeMailbox === "unread"),
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.moveThreadToTrash(hotkeyMessage.threadId);
          }, "Conversation moved to Trash.");
        },
        hotkey: "Shift+3",
        options: {
          enabled:
            !isActionPending &&
            activeMailbox !== "drafts" &&
            activeMailbox !== "trash",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.markThreadAsSpam(hotkeyMessage.threadId);
          }, "Conversation marked as Spam.");
        },
        hotkey: "Shift+1",
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider === "gmail" &&
            activeMailbox !== "drafts" &&
            activeMailbox === "inbox",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.markThreadAsRead(hotkeyMessage.threadId);
          }, "Conversation marked as Read.");
        },
        hotkey: "Shift+I",
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider !== "api" &&
            activeMailbox !== "drafts",
        },
      },
      {
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) {
            return;
          }
          void runHotkeyThreadAction(async () => {
            await mailboxActions.markThreadAsUnread(hotkeyMessage.threadId);
          }, "Conversation marked as Unread.");
        },
        hotkey: "Shift+U",
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider !== "api" &&
            activeMailbox !== "drafts",
        },
      },
    ]),
    { ignoreInputs: true }
  );
};

const useMessageViewFocus = ({
  focusOnOpen,
  onAutoFocusComplete,
}: Pick<MessageViewProps, "focusOnOpen" | "onAutoFocusComplete">) => {
  const viewRef = useRef<HTMLElement>(null);
  const onAutoFocusCompleteRef = useRef(onAutoFocusComplete);

  useEffect(() => {
    onAutoFocusCompleteRef.current = onAutoFocusComplete;
  }, [onAutoFocusComplete]);

  useEffect(() => {
    if (focusOnOpen !== true) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      const view = viewRef.current;
      const focusTarget = view?.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      );
      (focusTarget ?? view)?.focus({ focusVisible: true, preventScroll: true });
      onAutoFocusCompleteRef.current?.();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [focusOnOpen]);

  return viewRef;
};

type MessageViewContentProps = MessageViewProps &
  ReturnType<typeof useMessageViewData> & {
    viewRef: ReturnType<typeof useMessageViewFocus>;
  };

const MessageViewContent = (props: MessageViewContentProps) => {
  const {
    activeMailbox,
    apiSource,
    apiSourceAction,
    canComposeFromMailbox,
    currentUserEmail,
    gmailLabels,
    isActionPending,
    isBodyRefreshPending,
    isSingleMessageThread,
    mailboxActions,
    mailboxId,
    mailboxProvider,
    message,
    onComposeDraftRequested,
    subject,
    threadAttachments,
    threadIsUnread,
    threadLabelIds,
    threadMessages,
    usefulDetails,
    viewRef,
    visibleMessages,
  } = props;

  return (
    <article ref={viewRef} tabIndex={-1} className="@container w-full">
      <header className="w-full border-b p-3 @sm:px-5 @sm:py-4">
        <div className="flex min-w-0 flex-col items-start gap-2 @sm:grid @sm:grid-cols-[minmax(0,1fr)_auto] @sm:items-center @sm:gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-body/tight font-medium tracking-tight wrap-break-word text-fg @sm:text-body-lg">
              {subject}
            </h1>
            {!isSingleMessageThread && (
              <p className="text-caption text-muted-fg">
                {visibleMessages.length}{" "}
                {visibleMessages.length === 1 ? "message" : "messages"}
              </p>
            )}
          </div>

          {mailboxProvider !== "api" && (
            <div className="shrink-0 @sm:justify-self-end">
              <MessageActionsDropdown
                actions={createMailboxThreadMessageActionHandlers({
                  mailboxActions,
                  supportsFolders: mailboxProvider === "gmail",
                  supportsLabels: true,
                  supportsUnsubscribe: mailboxProvider === "gmail",
                })}
                isPending={isActionPending}
                isUnread={threadIsUnread}
                mailbox={activeMailbox}
                mailboxId={mailboxId}
                message={message}
                threadLabelIds={threadLabelIds}
              />
            </div>
          )}
        </div>

        <MessageLabels
          className="mt-2"
          compact
          labelIds={threadLabelIds}
          labels={gmailLabels}
        />

        {apiSource !== null && apiSource !== undefined && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-caption">
            <span className="text-muted-fg">
              Sent through API from {apiSource.senderAddress}.
            </span>
            {apiSourceAction}
          </div>
        )}

        <MessageAttachments
          attachments={threadAttachments}
          className="mt-3"
          mailboxId={mailboxId}
        />
      </header>

      {isSingleMessageThread ? (
        visibleMessages.map((threadMessage) => (
          <SingleMessageCard
            currentUserEmail={currentUserEmail}
            isLoading={isBodyRefreshPending}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={findLinkedDraftForMessage(
              threadMessages,
              threadMessage
            )}
            mailboxId={mailboxId}
            mailboxProvider={mailboxProvider}
            message={threadMessage}
            onComposeDraftRequested={
              canComposeFromMailbox ? onComposeDraftRequested : undefined
            }
            onUnsubscribe={
              mailboxProvider === "gmail"
                ? mailboxActions.unsubscribeFromMessage
                : undefined
            }
            usefulDetails={usefulDetails.filter(
              (detail) => detail.gmailMessageId === threadMessage.id
            )}
          />
        ))
      ) : (
        <ThreadMessageList
          allThreadMessages={threadMessages}
          currentUserEmail={currentUserEmail}
          isLoading={isBodyRefreshPending}
          isActionPending={isActionPending}
          key={message.threadId}
          mailboxId={mailboxId}
          mailboxProvider={mailboxProvider}
          messages={visibleMessages}
          onComposeDraftRequested={
            canComposeFromMailbox ? onComposeDraftRequested : undefined
          }
          onUnsubscribe={
            mailboxProvider === "gmail"
              ? mailboxActions.unsubscribeFromMessage
              : undefined
          }
          usefulDetails={usefulDetails}
        />
      )}
    </article>
  );
};

export const MessageView = (props: MessageViewProps) => {
  const data = useMessageViewData({
    mailboxId: props.mailboxId,
    mailboxProvider: props.mailboxProvider,
    message: props.message,
    pendingActions: props.pendingActions,
  });
  const viewRef = useMessageViewFocus({
    focusOnOpen: props.focusOnOpen,
    onAutoFocusComplete: props.onAutoFocusComplete,
  });

  useMessageViewHotkeys({
    activeMailbox: props.activeMailbox,
    canComposeFromMailbox: data.canComposeFromMailbox,
    currentUserEmail: props.currentUserEmail,
    hotkeyLinkedDraftMessage: data.hotkeyLinkedDraftMessage,
    hotkeyMessage: data.hotkeyMessage,
    isActionPending: data.isActionPending,
    mailboxActions: props.mailboxActions,
    mailboxProvider: props.mailboxProvider,
    onBackToList: props.onBackToList,
    onComposeDraftRequested: props.onComposeDraftRequested,
  });

  return <MessageViewContent {...props} {...data} viewRef={viewRef} />;
};
