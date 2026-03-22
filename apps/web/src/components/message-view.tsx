"use client";

import { ArrowDown01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from "@quietr/ui";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ComposeDraftState } from "~/lib/gmail/compose";
import {
  buildComposeDraftFromMessageAction,
  getPreferredThreadActionMessage,
  hasDistinctReplyAllRecipients,
} from "~/lib/gmail/compose-actions";
import { isMessageUnread, type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import { getMessageInspectorOptions } from "~/lib/gmail/message-inspector-query";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { MessageActionsDropdown } from "./message-actions";
import { MessageAttachments } from "./message-attachments";
import { MessageBody } from "./message-body";
import { SenderAvatar } from "./sender-avatar";

type MessageViewProps = {
  activeMailbox: MailboxCategory;
  currentUserEmail?: string | null;
  userId: string;
  message: MessageListItem;
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  onMarkThreadAsRead?: (threadId: string) => void | Promise<void>;
  onMarkThreadAsUnread?: (threadId: string) => void | Promise<void>;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsSpam?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onUpdateLabels?: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
  onUnsubscribe?: (messageId: string) => void | Promise<void>;
  onUnmarkAsSpam?: (messageId: string) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
  isActionPending?: boolean;
};

type MessageHeaderContentProps = {
  message: MessageListItem;
  className?: string;
  isExpanded?: boolean;
  previewMode?: "none" | "collapsed";
  senderNameClassName?: string;
  trailing?: ReactNode;
};

const formatEnvelopeValue = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const replyActionButtonClassName =
  "inline-flex h-8 items-center rounded-md border border-border/70 bg-background/70 px-3 text-xs font-medium text-foreground-light transition-colors outline-none hover:border-border hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30";

const inspectorToggleButtonClassName =
  "inline-flex h-7 items-center rounded-md border border-border/70 bg-background/70 px-2.5 text-[11px] font-medium text-foreground-light transition-colors outline-none hover:border-border hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30";

const detailsSectionTitleClassName = "text-sm font-semibold text-foreground";

const MessageHeaderContent = ({
  className,
  isExpanded,
  message,
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
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              {isMessageUnread(message) ? (
                <span aria-hidden className="size-2 rounded-full bg-foreground/75" />
              ) : null}

              <span
                className={cn(
                  "truncate text-sm text-foreground sm:text-[15px]",
                  senderNameClassName,
                  {
                    "font-semibold text-foreground-dark":
                      Boolean(isExpanded) || isMessageUnread(message),
                    "font-medium": !isExpanded && !isMessageUnread(message),
                  },
                )}
              >
                {senderName}
              </span>

              {senderEmail ? (
                <span className="truncate text-xs text-muted-foreground sm:text-sm">
                  {senderEmail}
                </span>
              ) : null}
            </div>

            {preview ? (
              <p className="mt-1 truncate text-sm text-foreground-light">{preview}</p>
            ) : null}

            {showParticipants ? (
              <div className="mt-1.5 space-y-1">
                {participantRows.map((row) => (
                  <div
                    className="flex min-w-0 items-baseline gap-2 text-xs sm:text-sm"
                    key={row.label}
                  >
                    <span className="shrink-0 text-muted-foreground">{row.label}</span>
                    <span className="min-w-0 truncate text-foreground-light">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="ml-2 flex shrink-0 items-center gap-3 pl-2">
            <span className="text-xs text-muted-foreground sm:text-sm">{date}</span>
            {trailing}
          </div>
        </div>
      </div>
    </div>
  );
};

const MessageComposeActions = ({
  className,
  onForward,
  onReply,
  onReplyAll,
  showReplyAll = true,
}: {
  className?: string;
  onForward: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  showReplyAll?: boolean;
}) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)}>
    <button className={replyActionButtonClassName} onClick={onReply} type="button">
      Reply
    </button>
    {showReplyAll ? (
      <button className={replyActionButtonClassName} onClick={onReplyAll} type="button">
        Reply all
      </button>
    ) : null}
    <button className={replyActionButtonClassName} onClick={onForward} type="button">
      Forward
    </button>
  </div>
);

const MessageInspectorPanel = ({
  message,
  open,
  userId,
  onOpenChange,
}: {
  message: MessageListItem;
  open: boolean;
  userId: string;
  onOpenChange: (open: boolean) => void;
}) => {
  const inspectorQuery = useQuery(getMessageInspectorOptions(userId, message.id, open));
  const inspector = inspectorQuery.data;
  const payloadText = inspector?.payload ? JSON.stringify(inspector.payload, null, 2) : "";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(92vw,56rem)]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">Full details</DialogTitle>
          <DialogDescription className="text-foreground-light">
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
                <h3 className={detailsSectionTitleClassName}>Summary</h3>
                {[
                  { label: "Message ID", value: inspector.messageHeaderId },
                  { label: "Subject", value: inspector.subject },
                  { label: "Date", value: inspector.date },
                  { label: "Snippet", value: inspector.snippet },
                ]
                  .filter((row) => Boolean(row.value?.trim()))
                  .map((row) => (
                    <p className="text-sm text-foreground-light" key={row.label}>
                      <span className="font-semibold text-foreground">{row.label}: </span>
                      <span className="break-words">{row.value}</span>
                    </p>
                  ))}
              </section>

              <section className="space-y-2">
                <h3 className={detailsSectionTitleClassName}>Headers</h3>
                {inspector.headers.map((header, index) => (
                  <p className="text-sm text-foreground-light" key={`${header.name}-${index}`}>
                    <span className="font-semibold text-foreground">{header.name}: </span>
                    <span className="break-words">{header.value}</span>
                  </p>
                ))}
              </section>

              {inspector.rawText ? (
                <section className="space-y-2">
                  <h3 className={detailsSectionTitleClassName}>Decoded source</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-sm text-foreground-light">
                    {inspector.rawText}
                  </pre>
                </section>
              ) : null}

              {inspector.raw ? (
                <section className="space-y-2">
                  <h3 className={detailsSectionTitleClassName}>Raw Gmail payload</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm text-foreground-light">
                    {inspector.raw}
                  </pre>
                </section>
              ) : null}

              {payloadText ? (
                <section className="space-y-2">
                  <h3 className={detailsSectionTitleClassName}>Structured payload</h3>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-sm text-foreground-light">
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
  actions,
  compact,
  message,
  userId,
}: {
  actions?: ReactNode;
  compact?: boolean;
  message: MessageListItem;
  userId: string;
}) => {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

  return (
    <div className="border-t border-border/60 pt-4 sm:pt-5">
      <MessageBody
        compact={compact}
        html={message.bodyHtml}
        snippet={message.snippet}
        text={message.bodyText}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        {actions}
        <button
          className={inspectorToggleButtonClassName}
          onClick={() => {
            setDetailsDialogOpen(true);
          }}
          type="button"
        >
          Details
        </button>
      </div>

      <MessageInspectorPanel
        message={message}
        onOpenChange={setDetailsDialogOpen}
        open={detailsDialogOpen}
        userId={userId}
      />
    </div>
  );
};

const ThreadMessageBody = ({
  actions,
  compact,
  expanded,
  message,
  userId,
}: {
  actions?: ReactNode;
  expanded: boolean;
  message: MessageListItem;
  compact?: boolean;
  userId: string;
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
        <MessageContentSection
          actions={actions}
          compact={compact}
          message={message}
          userId={userId}
        />
      </div>
    </div>
  </div>
);

const ThreadMessageList = ({
  currentUserEmail,
  messages,
  onComposeDraftRequested,
  userId,
}: {
  currentUserEmail?: string | null;
  messages: MessageListItem[];
  onComposeDraftRequested?: (draft: ComposeDraftState) => void;
  userId: string;
}) => {
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(
    messages[0]?.id ?? null,
  );

  const openComposeAction = (
    action: "reply" | "reply-all" | "forward",
    sourceMessage: MessageListItem | null,
  ) => {
    if (!sourceMessage || !onComposeDraftRequested) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        message: sourceMessage,
      }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {messages.map((threadMessage) => {
        const isExpanded = expandedMessageId === threadMessage.id;

        return (
          <section
            className={cn(
              "overflow-hidden rounded-xl border border-border transition-colors duration-200",
              {
                "bg-background-light": isExpanded,
                "bg-muted/40": isMessageUnread(threadMessage) && !isExpanded,
                "bg-background hover:bg-muted/30": !isExpanded && !isMessageUnread(threadMessage),
              },
            )}
            key={threadMessage.id}
          >
            <button
              aria-controls={`message-body-${threadMessage.id}`}
              aria-expanded={isExpanded}
              className="w-full text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => {
                setExpandedMessageId((current) =>
                  current === threadMessage.id ? null : threadMessage.id,
                );
              }}
              type="button"
            >
              <MessageHeaderContent
                className="px-4 py-4 sm:px-5 sm:py-4"
                isExpanded={isExpanded}
                message={threadMessage}
                previewMode="collapsed"
                trailing={
                  <HugeiconsIcon
                    aria-hidden="true"
                    className={cn(
                      "size-4 text-muted-foreground transition-transform duration-200",
                      {
                        "rotate-180 text-foreground/80": isExpanded,
                      },
                    )}
                    icon={ArrowDown01Icon}
                  />
                }
              />
            </button>

            <div id={`message-body-${threadMessage.id}`}>
              <ThreadMessageBody
                actions={
                  <MessageComposeActions
                    onForward={() => openComposeAction("forward", threadMessage)}
                    onReply={() => openComposeAction("reply", threadMessage)}
                    onReplyAll={() => openComposeAction("reply-all", threadMessage)}
                    showReplyAll={hasDistinctReplyAllRecipients(threadMessage, currentUserEmail)}
                  />
                }
                compact
                expanded={isExpanded}
                message={threadMessage}
                userId={userId}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
};

export const MessageView = ({
  activeMailbox,
  currentUserEmail,
  isActionPending,
  message,
  onComposeDraftRequested,
  onDeletePermanently,
  onMarkAsRead,
  onMarkAsSpam,
  onMarkAsUnread,
  onMarkThreadAsRead,
  onMarkThreadAsUnread,
  onMoveToTrash,
  onUnsubscribe,
  onUnmarkAsSpam,
  onUpdateLabels,
  userId,
}: MessageViewProps) => {
  const threadQuery = useSuspenseQuery(
    getThreadWithDetailsOptions(userId, activeMailbox, message.threadId),
  );

  const messages = threadQuery.data?.messages?.length
    ? [...threadQuery.data.messages].reverse()
    : [message];
  const subject = threadQuery.data?.subject || message.subject || "(No subject)";
  const threadIsUnread = messages.some((entry) => isMessageUnread(entry));
  const isSingleMessageThread = messages.length === 1;
  const threadAttachments = messages.flatMap((threadMessage) =>
    (threadMessage.attachments ?? []).map((attachment) => ({
      ...attachment,
      messageId: threadMessage.id,
    })),
  );
  const threadActionMessage = getPreferredThreadActionMessage(messages, currentUserEmail);
  const showThreadReplyAll = threadActionMessage
    ? hasDistinctReplyAllRecipients(threadActionMessage, currentUserEmail)
    : false;
  const autoMarkedThreadIdsRef = useRef<Set<string>>(new Set());

  const openComposeAction = (
    action: "reply" | "reply-all" | "forward",
    sourceMessage: MessageListItem | null,
  ) => {
    if (!sourceMessage || !onComposeDraftRequested) {
      return;
    }

    onComposeDraftRequested(
      buildComposeDraftFromMessageAction({
        action,
        currentUserEmail,
        message: sourceMessage,
      }),
    );
  };

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
          <h1 className="min-w-0 text-lg leading-tight font-medium tracking-tight wrap-break-word text-foreground-dark sm:text-xl">
            {subject}
          </h1>

          <MessageActionsDropdown
            isPending={isActionPending}
            isUnread={threadIsUnread}
            mailbox={activeMailbox}
            message={message}
            userId={userId}
            onDeletePermanently={onDeletePermanently}
            onMarkAsRead={(messageId) => {
              void (onMarkThreadAsRead?.(message.threadId) ?? onMarkAsRead?.(messageId));
            }}
            onMarkAsSpam={onMarkAsSpam}
            onMarkAsUnread={(messageId) => {
              void (onMarkThreadAsUnread?.(message.threadId) ?? onMarkAsUnread?.(messageId));
            }}
            onMoveToTrash={onMoveToTrash}
            onUnsubscribe={onUnsubscribe}
            onUnmarkAsSpam={onUnmarkAsSpam}
            onUpdateLabels={onUpdateLabels}
          />
        </div>

        {!isSingleMessageThread ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </p>
        ) : null}

        <MessageAttachments attachments={threadAttachments} className="mt-4" />

        {!isSingleMessageThread && threadActionMessage ? (
          <MessageComposeActions
            className="mt-4 border-t border-border/60 pt-4"
            onForward={() => openComposeAction("forward", threadActionMessage)}
            onReply={() => openComposeAction("reply", threadActionMessage)}
            onReplyAll={() => openComposeAction("reply-all", threadActionMessage)}
            showReplyAll={showThreadReplyAll}
          />
        ) : null}
      </header>

      {!isSingleMessageThread ? (
        <ThreadMessageList
          currentUserEmail={currentUserEmail}
          key={message.threadId}
          messages={messages}
          onComposeDraftRequested={onComposeDraftRequested}
          userId={userId}
        />
      ) : (
        messages.map((threadMessage) => (
          <section
            className="overflow-hidden rounded-xl border border-border bg-background-light"
            key={threadMessage.id}
          >
            <MessageHeaderContent
              className="px-4 py-4 sm:px-5 sm:py-5"
              message={threadMessage}
              senderNameClassName="text-base"
            />

            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <MessageContentSection
                actions={
                  <MessageComposeActions
                    onForward={() => openComposeAction("forward", threadMessage)}
                    onReply={() => openComposeAction("reply", threadMessage)}
                    onReplyAll={() => openComposeAction("reply-all", threadMessage)}
                    showReplyAll={hasDistinctReplyAllRecipients(threadMessage, currentUserEmail)}
                  />
                }
                compact
                message={threadMessage}
                userId={userId}
              />
            </div>
          </section>
        ))
      )}
    </article>
  );
};
