"use client";

import {
  ArrowDown01Icon,
  ArrowRightDoubleIcon,
  Loading03Icon,
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
  cn,
} from "@quietr/ui";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SenderAvatar } from "~/components/sender-avatar";
import {
  type ComposeDraftState,
  buildComposeDraftFromMessageAction,
  buildComposeDraftFromSavedDraftMessage,
  findLinkedDraftForMessage,
  hasDistinctReplyAllRecipients,
} from "~/features/compose";
import {
  isMessageUnread,
  type MailboxCategory,
  MAILBOX_LABELS,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import { getMessageInspectorOptions } from "~/lib/gmail/message-inspector-query";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { MessageActionsDropdown } from "./message-actions";
import { MessageAttachments } from "./message-attachments";
import { MessageBody } from "./message-body";

type MessageViewProps = {
  activeMailbox: MailboxCategory;
  currentUserEmail?: string | null;
  mailboxId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onMarkThreadAsRead?: (threadId: string) => void | Promise<void>;
  onMarkThreadAsUnread?: (threadId: string) => void | Promise<void>;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsSpam?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onMarkThreadAsSpam?: (threadId: string) => void | Promise<void>;
  onUpdateLabels?: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveThreadToTrash?: (threadId: string) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
  onUntrashThread?: (threadId: string) => void | Promise<void>;
  onUntrash?: (messageId: string) => void | Promise<void>;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onUnmarkThreadAsSpam?: (threadId: string) => void | Promise<void>;
  onUnmarkAsSpam?: (messageId: string) => void | Promise<void>;
  onDeleteThreadPermanently?: (threadId: string) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
  isActionPending?: boolean;
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

const formatEnvelopeValue = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const isDraftMessage = (message: MessageListItem) =>
  Boolean(message.draftId || message.labelIds?.includes(MAILBOX_LABELS.drafts));

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
  const participantRows = [
    { label: "To", value: formatEnvelopeValue(message.to) },
    { label: "From", value: formatEnvelopeValue(message.from) },
  ].filter((row) => Boolean(row.value));
  const showParticipants =
    participantRows.length > 0 && (previewMode !== "collapsed" || Boolean(isExpanded));
  const content = (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {isMessageUnread(message) ? (
          <span aria-hidden className="size-2 rounded-full bg-foreground/75" />
        ) : null}

        <span
          className={cn("truncate text-sm text-foreground sm:text-[15px]", senderNameClassName, {
            "font-semibold text-foreground": Boolean(isExpanded) || isMessageUnread(message),
            "font-medium": !isExpanded && !isMessageUnread(message),
          })}
        >
          {senderName}
        </span>

        {senderEmail ? (
          <span className="truncate text-xs text-muted-foreground sm:text-sm">{senderEmail}</span>
        ) : null}
      </div>

      {preview ? <p className="mt-1 truncate text-sm text-foreground">{preview}</p> : null}

      {showParticipants ? (
        <div className="mt-1.5 space-y-1">
          {participantRows.map((row) => (
            <div className="flex min-w-0 items-baseline gap-2 text-xs sm:text-sm" key={row.label}>
              <span className="shrink-0 text-muted-foreground">{row.label}</span>
              <span className="min-w-0 truncate text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "flex gap-4",
        { "items-start": Boolean(preview), "items-center": !preview },
        className,
      )}
    >
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

          <div className="ml-2 flex shrink-0 flex-col items-end justify-between gap-1.5 pl-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground sm:text-sm">{date}</span>
              {trailing}
            </div>
            {headerActions}
          </div>
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
  showReplyAll = true,
}: {
  className?: string;
  onContinueDraft?: () => void;
  onDetails: () => void;
  onForward: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  showReplyAll?: boolean;
}) => (
  <div className={cn("flex items-center justify-end gap-1.5", className)}>
    {onContinueDraft ? (
      <Button
        className="leading-tight"
        onClick={onContinueDraft}
        size="sm"
        type="button"
        variant="outline"
      >
        Continue with draft
      </Button>
    ) : null}
    <Button className="leading-tight" onClick={onReply} size="sm" type="button" variant="outline">
      <HugeiconsIcon aria-hidden icon={MailReply02Icon} />
      Reply
    </Button>
    {showReplyAll ? (
      <Button
        className="leading-tight"
        onClick={onReplyAll}
        size="sm"
        type="button"
        variant="outline"
      >
        <HugeiconsIcon aria-hidden icon={MailReplyAll02Icon} />
        Reply all
      </Button>
    ) : null}
    <Button className="leading-tight" onClick={onForward} size="sm" type="button" variant="outline">
      <HugeiconsIcon aria-hidden icon={ArrowRightDoubleIcon} />
      Forward
    </Button>
    <IconButtonTooltip label="Details">
      <Button
        aria-label="Details"
        className="ml-0.5 text-muted-foreground hover:text-foreground"
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
          ) : inspector ? (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Summary</h3>
                {[
                  { label: "Message ID", value: inspector.messageHeaderId },
                  { label: "Subject", value: inspector.subject },
                  { label: "Date", value: inspector.date },
                  { label: "Snippet", value: inspector.snippet },
                ]
                  .filter((row) => Boolean(row.value?.trim()))
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

              {inspector.rawText ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Decoded source</h3>
                  <pre className="overflow-x-auto text-sm whitespace-pre-wrap text-foreground">
                    {inspector.rawText}
                  </pre>
                </section>
              ) : null}

              {inspector.raw ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Raw Gmail payload</h3>
                  <pre className="overflow-x-auto text-sm break-all whitespace-pre-wrap text-foreground">
                    {inspector.raw}
                  </pre>
                </section>
              ) : null}

              {payloadText ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Structured payload</h3>
                  <pre className="overflow-x-auto text-sm whitespace-pre-wrap text-foreground">
                    {payloadText}
                  </pre>
                </section>
              ) : null}
            </>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton>Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const MessageContentSection = ({
  compact,
  message,
}: {
  compact?: boolean;
  message: MessageListItem;
}) => (
  <div className="border-t border-border/60 pt-4 sm:pt-5">
    <MessageBody
      compact={compact}
      html={message.bodyHtml}
      snippet={message.snippet}
      text={message.bodyText}
    />
  </div>
);

const ThreadMessageBody = ({
  compact,
  expanded,
  message,
}: {
  expanded: boolean;
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
            "translate-y-0 pt-2 opacity-100": expanded,
            "-translate-y-1 pt-0 opacity-0": !expanded,
          },
        )}
      >
        <MessageContentSection compact={compact} message={message} />
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
  linkedDraftMessage,
  mailboxId,
  message,
  onComposeDraftRequested,
  onToggleExpanded,
}: {
  currentUserEmail?: string | null;
  expanded: boolean;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
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
      className={cn(
        "overflow-hidden rounded-xl border border-border transition-colors duration-200",
        {
          "bg-background-light": expanded,
          "bg-muted/40": isMessageUnread(message) && !expanded,
          "bg-background hover:bg-muted/30": !expanded && !isMessageUnread(message),
        },
      )}
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
              onReply={() => openComposeAction("reply")}
              onReplyAll={() => openComposeAction("reply-all")}
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
        <ThreadMessageBody compact expanded={expanded} message={message} />
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
  linkedDraftMessage,
  mailboxId,
  message,
  onComposeDraftRequested,
}: {
  currentUserEmail?: string | null;
  linkedDraftMessage: MessageListItem | null;
  mailboxId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
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
    <section className="overflow-hidden rounded-xl border border-border bg-background-light">
      <MessageHeaderContent
        className="px-4 py-4 sm:px-5 sm:py-5"
        headerActions={
          <MessageHeaderActions
            onContinueDraft={linkedDraftMessage ? openLinkedDraft : undefined}
            onDetails={() => {
              setDetailsDialogOpen(true);
            }}
            onForward={() => openComposeAction("forward")}
            onReply={() => openComposeAction("reply")}
            onReplyAll={() => openComposeAction("reply-all")}
            showReplyAll={hasDistinctReplyAllRecipients(message, currentUserEmail)}
          />
        }
        message={message}
        senderNameClassName="text-base"
      />

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <MessageContentSection compact message={message} />
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
  currentUserEmail,
  mailboxId,
  messages,
  onComposeDraftRequested,
}: {
  currentUserEmail?: string | null;
  mailboxId: string;
  messages: MessageListItem[];
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
}) => {
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(
    messages[0]?.id ?? null,
  );

  return (
    <div className="flex flex-col gap-3">
      {messages.map((threadMessage) => {
        const isExpanded = expandedMessageId === threadMessage.id;
        const linkedDraftMessage = findLinkedDraftForMessage(messages, threadMessage);

        return (
          <ThreadMessageCard
            currentUserEmail={currentUserEmail}
            expanded={isExpanded}
            key={threadMessage.id}
            linkedDraftMessage={linkedDraftMessage}
            mailboxId={mailboxId}
            message={threadMessage}
            onComposeDraftRequested={onComposeDraftRequested}
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
  isActionPending,
  message,
  onComposeDraftRequested,
  onDeletePermanently,
  onMarkAsRead,
  onMarkAsSpam,
  onMarkAsUnread,
  onMarkThreadAsRead,
  onMarkThreadAsSpam,
  onMarkThreadAsUnread,
  onMoveThreadToTrash,
  onMoveToTrash,
  onDeleteThreadPermanently,
  onUntrashThread,
  onUntrash,
  onUnsubscribe,
  onUnmarkThreadAsSpam,
  onUnmarkAsSpam,
  onUpdateLabels,
}: MessageViewProps) => {
  const threadQuery = useSuspenseQuery(
    getThreadWithDetailsOptions(mailboxId, activeMailbox, message.threadId),
  );

  const threadMessages = threadQuery.data?.messages?.length
    ? [...threadQuery.data.messages].reverse()
    : [message];
  const messages = threadMessages.filter((threadMessage) => !isDraftMessage(threadMessage));
  const visibleMessages = messages.length > 0 ? messages : [message];
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

  useEffect(() => {
    if (!threadIsUnread) {
      autoMarkedThreadIdsRef.current.delete(message.threadId);
      return;
    }

    if (
      isActionPending ||
      !onMarkThreadAsRead ||
      autoMarkedThreadIdsRef.current.has(message.threadId)
    ) {
      return;
    }

    autoMarkedThreadIdsRef.current.add(message.threadId);

    Promise.resolve(onMarkThreadAsRead(message.threadId)).catch(() => {
      autoMarkedThreadIdsRef.current.delete(message.threadId);
    });
  }, [isActionPending, message.threadId, onMarkThreadAsRead, threadIsUnread]);

  return (
    <article className="mx-auto w-full max-w-5xl space-y-4">
      <header className="rounded-xl border border-border bg-background-light px-5 py-5 sm:px-6 sm:py-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8">
          <h1 className="min-w-0 text-lg leading-tight font-medium tracking-tight wrap-break-word text-foreground sm:text-xl">
            {subject}
          </h1>

          <MessageActionsDropdown
            isPending={isActionPending}
            isUnread={threadIsUnread}
            mailbox={activeMailbox}
            mailboxId={mailboxId}
            message={message}
            onMarkAsRead={(messageId) => {
              void (onMarkThreadAsRead?.(message.threadId) ?? onMarkAsRead?.(messageId));
            }}
            onMarkAsSpam={(messageId) => {
              void (onMarkThreadAsSpam?.(message.threadId) ?? onMarkAsSpam?.(messageId));
            }}
            onMarkAsUnread={(messageId) => {
              void (onMarkThreadAsUnread?.(message.threadId) ?? onMarkAsUnread?.(messageId));
            }}
            onMoveToTrash={(messageId) => {
              void (onMoveThreadToTrash?.(message.threadId) ?? onMoveToTrash?.(messageId));
            }}
            onUntrash={(messageId) => {
              void (onUntrashThread?.(message.threadId) ?? onUntrash?.(messageId));
            }}
            onUnsubscribe={onUnsubscribe}
            onUnmarkAsSpam={(messageId) => {
              void (onUnmarkThreadAsSpam?.(message.threadId) ?? onUnmarkAsSpam?.(messageId));
            }}
            onUpdateLabels={onUpdateLabels}
            onDeletePermanently={(messageId) => {
              void (
                onDeleteThreadPermanently?.(message.threadId) ?? onDeletePermanently?.(messageId)
              );
            }}
          />
        </div>

        {!isSingleMessageThread ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {visibleMessages.length} {visibleMessages.length === 1 ? "message" : "messages"}
          </p>
        ) : null}

        <MessageAttachments
          attachments={threadAttachments}
          className="mt-4"
          mailboxId={mailboxId}
        />
      </header>

      {!isSingleMessageThread ? (
        <ThreadMessageList
          currentUserEmail={currentUserEmail}
          key={message.threadId}
          mailboxId={mailboxId}
          messages={visibleMessages}
          onComposeDraftRequested={onComposeDraftRequested}
        />
      ) : (
        visibleMessages.map((threadMessage) => (
          <SingleMessageCard
            currentUserEmail={currentUserEmail}
            key={threadMessage.id}
            linkedDraftMessage={findLinkedDraftForMessage(threadMessages, threadMessage)}
            mailboxId={mailboxId}
            message={threadMessage}
            onComposeDraftRequested={onComposeDraftRequested}
          />
        ))
      )}
    </article>
  );
};
