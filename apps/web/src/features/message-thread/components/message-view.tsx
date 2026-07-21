"use client";

import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import {
  ArrowDown01Icon,
  ArrowRightDoubleIcon,
  ArrowUpRight01Icon,
  Edit01Icon,
  Loading03Icon,
  MailRemove01Icon,
  MailReply02Icon,
  MailReplyAll02Icon,
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
import { useState, type ReactNode } from "react";
import type {
  MailboxActions,
  MailboxPendingActions,
} from "~/features/mailbox/components/mailbox-action-handlers";
import { SenderAvatar } from "~/components/sender-avatar";
import {
  type ComposeDraftState,
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "~/features/compose";
import {
  GmailUsefulDetailCard,
  type GmailUsefulDetail,
} from "~/features/gmail-useful-details/components/gmail-useful-detail-card";
import { shouldIgnoreAppShortcut } from "~/features/hotkeys/domain/hotkey-guards";
import { MessageLabels } from "~/features/message-labels/components/message-labels";
import {
  hasRenderableMessageBody,
  isMessageUnread,
  type MailboxCategory,
  MAILBOX_LABELS,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import { getMessageInspectorOptions } from "~/lib/gmail/message-inspector-query";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { gmailThreadUsefulDetailsQueryOptions } from "~/lib/gmail/useful-details-query";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { createMailboxThreadMessageActionHandlers } from "./message-action-handlers";
import { MessageActionsDropdown } from "./message-actions";
import { MessageAttachments } from "./message-attachments";
import { MessageBody } from "./message-body";
import {
  getMessageUnsubscribeTarget,
  openUnsubscribeUrl,
  type MessageUnsubscribeTarget,
} from "./message-unsubscribe";

type MessageViewProps = {
  activeMailbox: MailboxCategory;
  currentUserEmail?: string | null;
  mailboxId: string;
  mailboxProvider: "api" | "gmail" | "managed";
  mailboxActions: MailboxActions;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onBackToList?: () => void;
  pendingActions: MailboxPendingActions;
};

type MessageHeaderContentProps = {
  gmailLabels: MailboxLabel[];
  message: MessageListItem;
  className?: string;
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
  const trimmed = value?.trim();
  return trimmed || null;
};

const isDraftMessage = (message: MessageListItem) =>
  !!(message.draftId || message.labelIds?.includes(MAILBOX_LABELS.drafts));

const getMessagesMissingLoadedBody = (messages: readonly MessageListItem[]) =>
  messages.filter(
    (threadMessage) => !!threadMessage.snippet?.trim() && !hasRenderableMessageBody(threadMessage),
  );

const getMessageUnsubscribeAction = (
  message: MessageListItem,
  onUnsubscribe?: (messageId: string) => void | Promise<void>,
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
    onClick: () => openUnsubscribeUrl(target.url),
  };
};

const runHotkeyThreadAction = async (
  action: () => void | Promise<void>,
  successMessage: string,
) => {
  try {
    await action();
    toast.success(successMessage);
  } catch (error) {
    toast.error(
      error instanceof Error && error.message ? error.message : "Could not update message.",
    );
  }
};

const MessageHeaderContent = ({
  className,
  gmailLabels,
  headerActions,
  isExpanded,
  message,
  onToggleExpanded,
  previewMode,
  senderNameClassName,
  trailing,
}: MessageHeaderContentProps) => {
  const sender = parseSender(message.from);
  const senderName = sender.name || sender.display || "Unknown sender";
  const senderEmail = sender.email || "";
  const senderInitial = (senderName.trim().charAt(0) || "?").toUpperCase();
  const date = formatMessageDate(message, "full") || "--";
  const preview = previewMode === "collapsed" && !isExpanded ? message.snippet?.trim() || "" : "";
  const participantRows = [{ label: "To", value: formatEnvelopeValue(message.to) }].filter(
    (row) => !!row.value,
  );
  const showParticipants =
    participantRows.length > 0 && (previewMode !== "collapsed" || !!isExpanded);
  const content = (
    <div className="w-full min-w-0 flex-1">
      <div className="flex w-full min-w-0 flex-wrap items-baseline justify-start gap-x-2 gap-y-1">
        {isMessageUnread(message) && (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-foreground/75" />
        )}

        <span
          className={cn(
            "max-w-full min-w-0 shrink truncate text-sm text-foreground @sm:text-[15px]",
            senderNameClassName,
            {
              "font-semibold text-foreground": !!isExpanded || isMessageUnread(message),
              "font-medium": !isExpanded && !isMessageUnread(message),
            },
          )}
        >
          {senderName}
        </span>

        {senderEmail && (
          <span className="max-w-full min-w-0 shrink truncate text-xs text-muted-foreground @sm:text-sm">
            {senderEmail}
          </span>
        )}

        <span className="shrink-0 basis-full text-xs whitespace-nowrap text-muted-foreground @sm:basis-auto @sm:text-sm">
          {date}
        </span>
      </div>

      {preview && <p className="mt-1 truncate text-sm text-foreground">{preview}</p>}

      <MessageLabels className="mt-1.5" labelIds={message.labelIds} labels={gmailLabels} />

      {showParticipants && (
        <div className="mt-1.5 space-y-1">
          {participantRows.map((row) => (
            <div className="flex min-w-0 items-start gap-2 text-xs @sm:text-sm" key={row.label}>
              <span className="shrink-0 text-muted-foreground">{row.label}</span>
              <span className="min-w-0 wrap-break-word text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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
              className="w-full min-w-0 cursor-pointer rounded-sm text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 @sm:flex-1"
              onClick={(event) => {
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed && selection.toString().trim()) {
                  for (let index = 0; index < selection.rangeCount; index++) {
                    if (selection.getRangeAt(index).intersectsNode(event.currentTarget)) {
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
  onForward,
  onReply,
  onReplyAll,
  onUnsubscribe,
  isPending,
  showReplyAll = true,
}: {
  className?: string;
  isPending?: boolean;
  onContinueDraft?: () => void;
  onDetails: () => void;
  onForward: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onUnsubscribe?: MessageUnsubscribeAction;
  showReplyAll?: boolean;
}) => (
  <div
    className={cn("flex flex-wrap items-center justify-start gap-0.5 @sm:justify-end", className)}
  >
    {onContinueDraft && (
      <IconButtonTooltip label="Continue with draft">
        <Button
          aria-label="Continue with draft"
          className="text-muted-foreground hover:text-foreground"
          onClick={onContinueDraft}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={Edit01Icon} />
        </Button>
      </IconButtonTooltip>
    )}
    <IconButtonTooltip label="Reply">
      <Button
        aria-label="Reply"
        className="text-muted-foreground hover:text-foreground"
        onClick={onReply}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden icon={MailReply02Icon} />
      </Button>
    </IconButtonTooltip>
    {showReplyAll && (
      <IconButtonTooltip label="Reply all">
        <Button
          aria-label="Reply all"
          className="text-muted-foreground hover:text-foreground"
          onClick={onReplyAll}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={MailReplyAll02Icon} />
        </Button>
      </IconButtonTooltip>
    )}
    <IconButtonTooltip label="Forward">
      <Button
        aria-label="Forward"
        className="text-muted-foreground hover:text-foreground"
        onClick={onForward}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden icon={ArrowRightDoubleIcon} />
      </Button>
    </IconButtonTooltip>
    {onUnsubscribe && (
      <IconButtonTooltip label="Unsubscribe">
        <Button
          aria-label="Unsubscribe"
          className="text-muted-foreground hover:text-foreground"
          disabled={isPending && onUnsubscribe.kind === "mailto"}
          onClick={onUnsubscribe.onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            aria-hidden
            icon={onUnsubscribe.kind === "mailto" ? MailRemove01Icon : ArrowUpRight01Icon}
          />
        </Button>
      </IconButtonTooltip>
    )}
    <IconButtonTooltip label="Details">
      <Button
        aria-label="Details"
        className="text-muted-foreground hover:text-foreground"
        onClick={onDetails}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden icon={ZoomInAreaIcon} />
      </Button>
    </IconButtonTooltip>
  </div>
);

const MessageInspectorPanel = ({
  mailboxId,
  message,
  open,
  onOpenChange,
}: {
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
  const payloadText = inspector?.payload ? JSON.stringify(inspector.payload, null, 2) : "";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(92vw,56rem)]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">Full details</DialogTitle>
          <DialogDescription className="text-foreground">
            Complete information available for this message.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          {isInspectorPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon aria-hidden className="animate-spin" icon={Loading03Icon} />
              <span>Loading message details…</span>
            </div>
          ) : isInspectorError ? (
            <p className="text-sm text-destructive">
              {inspectorError.message || "Could not load message details."}
            </p>
          ) : (
            inspector && (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Summary</h3>
                  {[
                    { label: "Reference", value: inspector.messageHeaderId },
                    { label: "Subject", value: inspector.subject },
                    { label: "Date", value: inspector.date },
                    { label: "Snippet", value: inspector.snippet },
                  ].flatMap((row) =>
                    row.value?.trim()
                      ? [
                          <p className="text-sm text-foreground" key={row.label}>
                            <span className="font-semibold text-foreground">{row.label}: </span>
                            <span className="wrap-break-word">{row.value}</span>
                          </p>,
                        ]
                      : [],
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Delivery details</h3>
                  {inspector.headers.map((header) => (
                    <p
                      className="text-sm text-foreground"
                      key={`${inspector.messageHeaderId}-${header.name}-${header.value}`}
                    >
                      <span className="font-semibold text-foreground">{header.name}: </span>
                      <span className="wrap-break-word">{header.value}</span>
                    </p>
                  ))}
                </section>

                {inspector.rawText && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Original message</h3>
                    <pre className="overflow-x-auto text-sm whitespace-pre-wrap text-foreground">
                      {inspector.rawText}
                    </pre>
                  </section>
                )}

                {inspector.raw && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Gmail record</h3>
                    <pre className="overflow-x-auto text-sm break-all whitespace-pre-wrap text-foreground">
                      {inspector.raw}
                    </pre>
                  </section>
                )}

                {payloadText && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Message structure</h3>
                    <pre className="overflow-x-auto text-sm whitespace-pre-wrap text-foreground">
                      {payloadText}
                    </pre>
                  </section>
                )}
              </>
            )
          )}
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
    className="grid overflow-hidden"
    style={{
      gridTemplateRows: expanded ? "1fr" : "0fr",
      pointerEvents: expanded ? "auto" : "none",
      transition: "grid-template-rows 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out",
    }}
  >
    <div className="min-h-0 overflow-hidden">
      <div
        className={cn(
          "px-4 pb-4 transition-[opacity,transform,padding] duration-200 ease-out @sm:px-5 @sm:pb-5",
          {
            "translate-y-0 opacity-100": expanded,
            "-translate-y-1 opacity-0": !expanded,
          },
        )}
      >
        <MessageBody html={message.bodyHtml} isLoading={isLoading} text={message.bodyText} />
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
      className={cn("text-muted-foreground hover:text-foreground", {
        "text-foreground/80": expanded,
      })}
      onClick={onToggleExpanded}
      size="icon-sm"
      variant="ghost"
    >
      <HugeiconsIcon
        aria-hidden
        className={cn("transition-transform duration-200", {
          "rotate-180": expanded,
        })}
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
  gmailLabels,
  mailboxId,
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
  gmailLabels: MailboxLabel[];
  mailboxId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onToggleExpanded: () => void;
  usefulDetails: GmailUsefulDetail[];
}) => {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

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
      }),
    );
  };

  const openLinkedDraft = () => {
    if (!onComposeDraftRequested || !linkedDraftMessage) {
      return;
    }

    onComposeDraftRequested(buildComposeDraftFromSavedDraftMessage(linkedDraftMessage));
  };

  return (
    <section
      className={cn("border-b transition-colors duration-200", {
        "border-foreground/40": isMessageUnread(message) && !expanded,
      })}
    >
      <MessageHeaderContent
        className="p-4 @sm:px-5 @sm:py-4"
        gmailLabels={gmailLabels}
        headerActions={
          expanded ? (
            <MessageHeaderActions
              onContinueDraft={linkedDraftMessage ? openLinkedDraft : undefined}
              onDetails={() => {
                setDetailsDialogOpen(true);
              }}
              onForward={() => openComposeAction("forward")}
              isPending={isActionPending}
              onReply={() => openComposeAction("reply")}
              onReplyAll={() => openComposeAction("reply-all")}
              onUnsubscribe={getMessageUnsubscribeAction(message, onUnsubscribe)}
              showReplyAll={hasDistinctReplyAllRecipients(message, currentUserEmail)}
            />
          ) : null
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
            <GmailUsefulDetailCard detail={detail} key={detail.id} mailboxId={mailboxId} />
          ))}
        </div>
      )}

      <div id={`message-body-${message.id}`}>
        <ThreadMessageBody expanded={expanded} isLoading={isLoading} message={message} />
      </div>

      <MessageInspectorPanel
        mailboxId={mailboxId}
        message={message}
        onOpenChange={setDetailsDialogOpen}
        open={detailsDialogOpen}
      />
    </section>
  );
};

const SingleMessageCard = ({
  currentUserEmail,
  isLoading,
  linkedDraftMessage,
  gmailLabels,
  mailboxId,
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
  gmailLabels: MailboxLabel[];
  mailboxId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  usefulDetails: GmailUsefulDetail[];
}) => {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

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
      }),
    );
  };

  const openLinkedDraft = () => {
    if (!onComposeDraftRequested || !linkedDraftMessage) {
      return;
    }

    onComposeDraftRequested(buildComposeDraftFromSavedDraftMessage(linkedDraftMessage));
  };

  return (
    <section>
      <MessageHeaderContent
        className="p-4 @sm:p-5"
        gmailLabels={gmailLabels}
        headerActions={
          <MessageHeaderActions
            onContinueDraft={linkedDraftMessage ? openLinkedDraft : undefined}
            onDetails={() => {
              setDetailsDialogOpen(true);
            }}
            onForward={() => openComposeAction("forward")}
            isPending={isActionPending}
            onReply={() => openComposeAction("reply")}
            onReplyAll={() => openComposeAction("reply-all")}
            onUnsubscribe={getMessageUnsubscribeAction(message, onUnsubscribe)}
            showReplyAll={hasDistinctReplyAllRecipients(message, currentUserEmail)}
          />
        }
        message={message}
        senderNameClassName="text-base"
      />

      {usefulDetails.length > 0 && (
        <div className="space-y-1.5 px-4 pb-3 @sm:px-5">
          {usefulDetails.map((detail) => (
            <GmailUsefulDetailCard detail={detail} key={detail.id} mailboxId={mailboxId} />
          ))}
        </div>
      )}

      <div className="px-4 pb-4 @sm:px-5 @sm:pb-5">
        <MessageBody html={message.bodyHtml} isLoading={isLoading} text={message.bodyText} />
      </div>

      <MessageInspectorPanel
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
  gmailLabels,
  mailboxId,
  messages,
  onComposeDraftRequested,
  onUnsubscribe,
  isActionPending,
  usefulDetails,
}: {
  allThreadMessages: MessageListItem[];
  currentUserEmail?: string | null;
  isLoading?: boolean;
  gmailLabels: MailboxLabel[];
  isActionPending?: boolean;
  mailboxId: string;
  messages: MessageListItem[];
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  usefulDetails: GmailUsefulDetail[];
}) => {
  const [expandedMessageIds, setExpandedMessageIds] = useState<string[]>(
    messages.length ? [messages[0].id] : [],
  );

  return (
    <div>
      {messages.map((threadMessage) => {
        const isExpanded = expandedMessageIds.includes(threadMessage.id);
        const linkedDraftMessage = findLinkedDraftForMessage(allThreadMessages, threadMessage);

        return (
          <ThreadMessageCard
            currentUserEmail={currentUserEmail}
            expanded={isExpanded}
            gmailLabels={gmailLabels}
            isLoading={isLoading}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={linkedDraftMessage}
            mailboxId={mailboxId}
            message={threadMessage}
            onComposeDraftRequested={onComposeDraftRequested}
            onUnsubscribe={onUnsubscribe}
            onToggleExpanded={() => {
              setExpandedMessageIds((current) =>
                isExpanded
                  ? current.filter((id) => id !== threadMessage.id)
                  : [...current, threadMessage.id],
              );
            }}
            usefulDetails={usefulDetails.filter(
              (detail) => detail.gmailMessageId === threadMessage.id,
            )}
          />
        );
      })}
    </div>
  );
};

export const MessageView = ({
  activeMailbox,
  mailboxId,
  mailboxProvider,
  currentUserEmail,
  mailboxActions,
  message,
  onComposeDraftRequested,
  onBackToList,
  pendingActions,
}: MessageViewProps) => {
  const queryClient = useQueryClient();
  const { data: gmailLabels = [] } = useQuery(
    labelsQueryOptions(mailboxId, mailboxProvider !== "api"),
  );
  const {
    data: threadData,
    isFetching: isThreadFetching,
    isPending: isThreadPending,
  } = useQuery({
    // react-doctor-disable-next-line react-doctor/no-event-handler
    ...getThreadWithDetailsOptions(mailboxId, message.threadId),
    placeholderData: {
      threadId: message.threadId,
      snippet: message.snippet,
      subject: message.subject,
      messages: [message],
    },
    refetchInterval: (query) => {
      const thread = query.state.data;
      return thread &&
        query.state.dataUpdateCount < 2 &&
        getMessagesMissingLoadedBody(thread.messages).length > 0
        ? 250
        : false;
    },
  });
  const { data: usefulDetails = [] } = useQuery(
    gmailThreadUsefulDetailsQueryOptions(mailboxId, message.threadId, mailboxProvider === "gmail"),
  );
  const createApiMailboxMutation = useMutation({
    ...orpc.mail.createManagedMailboxForApiMessage.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: ["messages", mailboxId] }),
      ]);
      toast.success("Mailbox created.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not create mailbox.");
    },
  });
  const threadMessages = threadData?.messages?.length
    ? [...threadData.messages].reverse()
    : [message];
  const messages = threadMessages.filter((threadMessage) => !isDraftMessage(threadMessage));
  const visibleMessages = messages.length > 0 ? messages : [message];
  const messagesMissingLoadedBody = getMessagesMissingLoadedBody(visibleMessages);
  const hasMissingLoadedBody = messagesMissingLoadedBody.length > 0;
  const isBodyRefreshPending = isThreadPending || isThreadFetching || hasMissingLoadedBody;
  const subject =
    visibleMessages.reduce<string | undefined>((resolvedSubject, threadMessage) => {
      if (!threadMessage.subject?.trim()) {
        return resolvedSubject;
      }

      return threadMessage.subject;
    }, undefined) ||
    threadData?.subject ||
    message.subject ||
    "(No subject)";
  const threadIsUnread = visibleMessages.some((entry) => isMessageUnread(entry));
  const isSingleMessageThread = visibleMessages.length === 1;
  const canComposeFromMailbox = mailboxProvider !== "api";
  const apiSource = message.apiSource;
  const threadAttachments = visibleMessages.flatMap((threadMessage) =>
    (threadMessage.attachments ?? []).map((attachment) => ({
      ...attachment,
      messageId: threadMessage.id,
    })),
  );
  const isActionPending =
    pendingActions.isMessageActionPending(message.id) ||
    pendingActions.isThreadActionPending(message.threadId);
  const hotkeyMessage = visibleMessages[0] ?? message;
  const hotkeyLinkedDraftMessage = findLinkedDraftForMessage(threadMessages, hotkeyMessage);
  const requestComposeAction = (action: "reply" | "reply-all" | "forward") => {
    if (!canComposeFromMailbox || !onComposeDraftRequested) return;

    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        existingDraftMessage: hotkeyLinkedDraftMessage,
        message: hotkeyMessage,
      }),
    );
  };
  useHotkeys(
    [
      {
        hotkey: "R",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          requestComposeAction("reply");
        },
        options: {
          enabled: canComposeFromMailbox && !!onComposeDraftRequested && activeMailbox !== "drafts",
        },
      },
      {
        hotkey: "A",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          requestComposeAction("reply-all");
        },
        options: {
          enabled:
            !!onComposeDraftRequested &&
            canComposeFromMailbox &&
            activeMailbox !== "drafts" &&
            hasDistinctReplyAllRecipients(hotkeyMessage, currentUserEmail),
        },
      },
      {
        hotkey: "F",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          requestComposeAction("forward");
        },
        options: {
          enabled: canComposeFromMailbox && !!onComposeDraftRequested && activeMailbox !== "drafts",
        },
      },
      {
        hotkey: "E",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runHotkeyThreadAction(async () => {
            await mailboxActions.archiveThread(hotkeyMessage.threadId);
            onBackToList?.();
          }, "Conversation archived.");
        },
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider !== "api" &&
            (activeMailbox === "inbox" || activeMailbox === "unread"),
        },
      },
      {
        hotkey: "Shift+3",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runHotkeyThreadAction(
            () => mailboxActions.moveThreadToTrash(hotkeyMessage.threadId),
            "Conversation moved to Trash.",
          );
        },
        options: {
          enabled: !isActionPending && activeMailbox !== "drafts" && activeMailbox !== "trash",
        },
      },
      {
        hotkey: "Shift+1",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runHotkeyThreadAction(
            () => mailboxActions.markThreadAsSpam(hotkeyMessage.threadId),
            "Conversation marked as Spam.",
          );
        },
        options: {
          enabled:
            !isActionPending &&
            mailboxProvider === "gmail" &&
            activeMailbox !== "drafts" &&
            activeMailbox === "inbox",
        },
      },
      {
        hotkey: "Shift+I",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runHotkeyThreadAction(
            () => mailboxActions.markThreadAsRead(hotkeyMessage.threadId),
            "Conversation marked as Read.",
          );
        },
        options: {
          enabled: !isActionPending && mailboxProvider !== "api" && activeMailbox !== "drafts",
        },
      },
      {
        hotkey: "Shift+U",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          void runHotkeyThreadAction(
            () => mailboxActions.markThreadAsUnread(hotkeyMessage.threadId),
            "Conversation marked as Unread.",
          );
        },
        options: {
          enabled: !isActionPending && mailboxProvider !== "api" && activeMailbox !== "drafts",
        },
      },
      {
        hotkey: "U",
        callback: (event) => {
          if (shouldIgnoreAppShortcut(event)) return;
          onBackToList?.();
        },
        options: { enabled: !!onBackToList },
      },
    ],
    { ignoreInputs: true },
  );

  return (
    <article className="@container w-full">
      <header className="w-full border-b p-5 @sm:p-6">
        <div className="flex min-w-0 flex-col items-start gap-3 @sm:grid @sm:grid-cols-[minmax(0,1fr)_auto] @sm:items-center @sm:gap-8">
          <h1 className="min-w-0 text-lg/tight font-medium tracking-tight wrap-break-word text-foreground @sm:text-xl">
            {subject}
          </h1>

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
              />
            </div>
          )}
        </div>

        {apiSource && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              Sent through API from {apiSource.senderAddress}.
            </span>
            {apiSource.canCreateMailbox ? (
              <Button
                disabled={createApiMailboxMutation.isPending}
                onClick={() =>
                  createApiMailboxMutation.mutate({
                    mailboxId,
                    messageId: message.id,
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                {createApiMailboxMutation.isPending && (
                  <HugeiconsIcon
                    aria-hidden
                    className="size-3.5 animate-spin"
                    icon={Loading03Icon}
                  />
                )}
                Create mailbox
              </Button>
            ) : apiSource.senderMailboxId ? (
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground squircle">
                {apiSource.includedInMailbox ? "Included in mailbox" : "Mailbox copy disabled"}
              </span>
            ) : null}
          </div>
        )}

        {!isSingleMessageThread && (
          <p className="mt-2 text-sm text-muted-foreground">
            {visibleMessages.length} {visibleMessages.length === 1 ? "message" : "messages"}
          </p>
        )}

        <MessageAttachments
          attachments={threadAttachments}
          className="mt-4"
          mailboxId={mailboxId}
        />
      </header>

      {!isSingleMessageThread ? (
        <ThreadMessageList
          allThreadMessages={threadMessages}
          currentUserEmail={currentUserEmail}
          gmailLabels={gmailLabels}
          isLoading={isBodyRefreshPending}
          isActionPending={isActionPending}
          key={message.threadId}
          mailboxId={mailboxId}
          messages={visibleMessages}
          onComposeDraftRequested={canComposeFromMailbox ? onComposeDraftRequested : undefined}
          onUnsubscribe={
            mailboxProvider === "gmail" ? mailboxActions.unsubscribeFromMessage : undefined
          }
          usefulDetails={usefulDetails}
        />
      ) : (
        visibleMessages.map((threadMessage) => (
          <SingleMessageCard
            currentUserEmail={currentUserEmail}
            gmailLabels={gmailLabels}
            isLoading={isBodyRefreshPending}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={findLinkedDraftForMessage(threadMessages, threadMessage)}
            mailboxId={mailboxId}
            message={threadMessage}
            onComposeDraftRequested={canComposeFromMailbox ? onComposeDraftRequested : undefined}
            onUnsubscribe={
              mailboxProvider === "gmail" ? mailboxActions.unsubscribeFromMessage : undefined
            }
            usefulDetails={usefulDetails.filter(
              (detail) => detail.gmailMessageId === threadMessage.id,
            )}
          />
        ))
      )}
    </article>
  );
};
