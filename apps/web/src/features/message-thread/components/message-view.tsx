"use client";

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
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButtonTooltip,
  TooltipGroup,
  cn,
} from "@quieter/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  hasRenderableMessageBody,
  isMessageUnread,
  type MailboxCategory,
  MAILBOX_LABELS,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import { getMessageInspectorOptions } from "~/lib/gmail/message-inspector-query";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import {
  createMailboxThreadMessageActionHandlers,
  MessageActionsDropdown,
} from "./message-actions";
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
  mailboxActions: MailboxActions;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  pendingActions: MailboxPendingActions;
};

type MessageHeaderContentProps = {
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

const MessageHeaderContent = ({
  className,
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
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {isMessageUnread(message) && (
          <span aria-hidden className="size-2 rounded-full bg-foreground/75" />
        )}

        <span
          className={cn("truncate text-sm text-foreground sm:text-[15px]", senderNameClassName, {
            "font-semibold text-foreground": !!isExpanded || isMessageUnread(message),
            "font-medium": !isExpanded && !isMessageUnread(message),
          })}
        >
          {senderName}
        </span>

        {senderEmail && (
          <span className="truncate text-xs text-muted-foreground sm:text-sm">{senderEmail}</span>
        )}

        <span className="shrink-0 text-xs text-muted-foreground sm:text-sm">{date}</span>
      </div>

      {preview && <p className="mt-1 truncate text-sm text-foreground">{preview}</p>}

      {showParticipants && (
        <div className="mt-1.5 space-y-1">
          {participantRows.map((row) => (
            <div className="flex min-w-0 items-baseline gap-2 text-xs sm:text-sm" key={row.label}>
              <span className="shrink-0 text-muted-foreground">{row.label}</span>
              <span className="min-w-0 truncate text-foreground">{row.value}</span>
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
        <div className="flex min-w-0 items-stretch justify-between gap-3">
          {onToggleExpanded ? (
            <button
              className="min-w-0 flex-1 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={onToggleExpanded}
              type="button"
            >
              {content}
            </button>
          ) : (
            content
          )}

          <TooltipGroup>
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1 pl-4">
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
  <div className={cn("flex items-center justify-end gap-0.5", className)}>
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
  const inspectorQuery = useQuery(getMessageInspectorOptions(mailboxId, message.id, open));
  const inspector = inspectorQuery.data;
  const payloadText = inspector?.payload ? JSON.stringify(inspector.payload, null, 2) : "";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(92vw,56rem)]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">Full details</DialogTitle>
          <DialogDescription className="text-foreground">
            Headers, message source, and Gmail payload for this message.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          {inspectorQuery.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon aria-hidden className="animate-spin" icon={Loading03Icon} />
              <span>Loading message details...</span>
            </div>
          ) : inspectorQuery.isError ? (
            <p className="text-sm text-destructive">
              {inspectorQuery.error.message || "Could not load message details."}
            </p>
          ) : (
            inspector && (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Summary</h3>
                  {[
                    { label: "Message ID", value: inspector.messageHeaderId },
                    { label: "Subject", value: inspector.subject },
                    { label: "Date", value: inspector.date },
                    { label: "Snippet", value: inspector.snippet },
                  ]
                    .filter((row) => !!row.value?.trim())
                    .map((row) => (
                      <p className="text-sm text-foreground" key={row.label}>
                        <span className="font-semibold text-foreground">{row.label}: </span>
                        <span className="wrap-break-word">{row.value}</span>
                      </p>
                    ))}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Headers</h3>
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
                    <h3 className="text-sm font-semibold text-foreground">Decoded source</h3>
                    <pre className="overflow-x-auto text-sm whitespace-pre-wrap text-foreground">
                      {inspector.rawText}
                    </pre>
                  </section>
                )}

                {inspector.raw && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Raw Gmail payload</h3>
                    <pre className="overflow-x-auto text-sm break-all whitespace-pre-wrap text-foreground">
                      {inspector.raw}
                    </pre>
                  </section>
                )}

                {payloadText && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Structured payload</h3>
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
  compact,
  expanded,
  isLoading,
  message,
}: {
  expanded: boolean;
  isLoading?: boolean;
  message: MessageListItem;
  compact?: boolean;
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
          "px-4 pb-4 transition-[opacity,transform,padding] duration-200 ease-out sm:px-5 sm:pb-5",
          {
            "translate-y-0 opacity-100": expanded,
            "-translate-y-1 opacity-0": !expanded,
          },
        )}
      >
        <MessageBody
          compact={compact}
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
  mailboxId,
  message,
  onComposeDraftRequested,
  onUnsubscribe,
  onToggleExpanded,
  isActionPending,
}: {
  currentUserEmail?: string | null;
  expanded: boolean;
  isLoading?: boolean;
  isActionPending?: boolean;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onToggleExpanded: () => void;
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
        className="px-4 py-4 sm:px-5 sm:py-4"
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

      <div id={`message-body-${message.id}`}>
        <ThreadMessageBody compact expanded={expanded} isLoading={isLoading} message={message} />
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
  mailboxId,
  message,
  onComposeDraftRequested,
  onUnsubscribe,
  isActionPending,
}: {
  currentUserEmail?: string | null;
  isLoading?: boolean;
  isActionPending?: boolean;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
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
        className="px-4 py-4 sm:px-5 sm:py-5"
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

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <MessageBody
          compact
          html={message.bodyHtml}
          isLoading={isLoading}
          text={message.bodyText}
        />
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
  mailboxId,
  messages,
  onComposeDraftRequested,
  onUnsubscribe,
  isActionPending,
}: {
  allThreadMessages: MessageListItem[];
  currentUserEmail?: string | null;
  isLoading?: boolean;
  isActionPending?: boolean;
  mailboxId: string;
  messages: MessageListItem[];
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
}) => {
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(
    messages[0]?.id ?? null,
  );

  return (
    <div>
      {messages.map((threadMessage) => {
        const isExpanded = expandedMessageId === threadMessage.id;
        const linkedDraftMessage = findLinkedDraftForMessage(allThreadMessages, threadMessage);

        return (
          <ThreadMessageCard
            currentUserEmail={currentUserEmail}
            expanded={isExpanded}
            isLoading={isLoading}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={linkedDraftMessage}
            mailboxId={mailboxId}
            message={threadMessage}
            onComposeDraftRequested={onComposeDraftRequested}
            onUnsubscribe={onUnsubscribe}
            onToggleExpanded={() => {
              setExpandedMessageId((current) =>
                current === threadMessage.id ? null : threadMessage.id,
              );
            }}
          />
        );
      })}
    </div>
  );
};

export const MessageView = ({
  activeMailbox,
  mailboxId,
  currentUserEmail,
  mailboxActions,
  message,
  onComposeDraftRequested,
  pendingActions,
}: MessageViewProps) => {
  const threadQuery = useQuery({
    ...getThreadWithDetailsOptions(mailboxId, message.threadId),
    placeholderData: {
      threadId: message.threadId,
      snippet: message.snippet,
      subject: message.subject,
      messages: [message],
    },
  });
  const {
    isError: isThreadError,
    isFetching: isThreadFetching,
    isPending: isThreadPending,
    refetch: refetchThread,
  } = threadQuery;

  const threadMessages = threadQuery.data?.messages?.length
    ? [...threadQuery.data.messages].reverse()
    : [message];
  const messages = threadMessages.filter((threadMessage) => !isDraftMessage(threadMessage));
  const visibleMessages = messages.length > 0 ? messages : [message];
  const messagesMissingLoadedBody = getMessagesMissingLoadedBody(visibleMessages);
  const missingLoadedBodyKey = messagesMissingLoadedBody
    .map((threadMessage) => threadMessage.id)
    .join(":");
  const hasMissingLoadedBody = messagesMissingLoadedBody.length > 0;
  const isBodyRefreshPending = isThreadPending || isThreadFetching || hasMissingLoadedBody;
  const subject =
    visibleMessages.reduce<string | undefined>((resolvedSubject, threadMessage) => {
      if (!threadMessage.subject?.trim()) {
        return resolvedSubject;
      }

      return threadMessage.subject;
    }, undefined) ||
    threadQuery.data?.subject ||
    message.subject ||
    "(No subject)";
  const threadIsUnread = visibleMessages.some((entry) => isMessageUnread(entry));
  const isSingleMessageThread = visibleMessages.length === 1;
  const threadAttachments = visibleMessages.flatMap((threadMessage) =>
    (threadMessage.attachments ?? []).map((attachment) => ({
      ...attachment,
      messageId: threadMessage.id,
    })),
  );
  const autoMarkedThreadIdsRef = useRef<Set<string>>(new Set());
  const bodyRefreshRequestKeyRef = useRef<string | null>(null);
  const isActionPending =
    pendingActions.isMessageActionPending(message.id) ||
    pendingActions.isThreadActionPending(message.threadId);

  useEffect(() => {
    if (!hasMissingLoadedBody) {
      bodyRefreshRequestKeyRef.current = null;
      return;
    }

    if (isThreadError || isThreadFetching || isThreadPending) {
      return;
    }

    const requestKey = `${mailboxId}:${message.threadId}:${missingLoadedBodyKey}`;
    if (bodyRefreshRequestKeyRef.current === requestKey) {
      return;
    }

    bodyRefreshRequestKeyRef.current = requestKey;
    void refetchThread();
  }, [
    hasMissingLoadedBody,
    isThreadError,
    isThreadFetching,
    isThreadPending,
    mailboxId,
    message.threadId,
    missingLoadedBodyKey,
    refetchThread,
  ]);

  useEffect(() => {
    if (!threadIsUnread) {
      autoMarkedThreadIdsRef.current.delete(message.threadId);
      return;
    }

    if (isActionPending || autoMarkedThreadIdsRef.current.has(message.threadId)) {
      return;
    }

    autoMarkedThreadIdsRef.current.add(message.threadId);

    Promise.resolve(mailboxActions.markThreadAsRead(message.threadId)).catch(() => {
      autoMarkedThreadIdsRef.current.delete(message.threadId);
    });
  }, [isActionPending, mailboxActions, message.threadId, threadIsUnread]);

  return (
    <article className="-mx-4 w-auto sm:-mx-5 lg:-mx-6">
      <header className="border-b px-5 py-5 sm:px-6 sm:py-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8">
          <h1 className="min-w-0 text-lg leading-tight font-medium tracking-tight wrap-break-word text-foreground sm:text-xl">
            {subject}
          </h1>

          <MessageActionsDropdown
            actions={createMailboxThreadMessageActionHandlers({
              mailboxActions,
              threadId: message.threadId,
            })}
            isPending={isActionPending}
            isUnread={threadIsUnread}
            mailbox={activeMailbox}
            mailboxId={mailboxId}
            message={message}
          />
        </div>

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
          isLoading={isBodyRefreshPending}
          isActionPending={isActionPending}
          key={message.threadId}
          mailboxId={mailboxId}
          messages={visibleMessages}
          onComposeDraftRequested={onComposeDraftRequested}
          onUnsubscribe={mailboxActions.unsubscribeFromMessage}
        />
      ) : (
        visibleMessages.map((threadMessage) => (
          <SingleMessageCard
            currentUserEmail={currentUserEmail}
            isLoading={isBodyRefreshPending}
            isActionPending={isActionPending}
            key={threadMessage.id}
            linkedDraftMessage={findLinkedDraftForMessage(threadMessages, threadMessage)}
            mailboxId={mailboxId}
            message={threadMessage}
            onComposeDraftRequested={onComposeDraftRequested}
            onUnsubscribe={mailboxActions.unsubscribeFromMessage}
          />
        ))
      )}
    </article>
  );
};
