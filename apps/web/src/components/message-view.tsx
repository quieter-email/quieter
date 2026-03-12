"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quietr/ui";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { isMessageUnread, type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import { formatMessageDate, parseSender } from "~/lib/gmail/message-utils";
import { getThreadWithDetailsOptions } from "~/lib/gmail/thread-query";
import { MessageActionsDropdown } from "./message-actions";
import { MessageAttachments } from "./message-attachments";
import { MessageBody } from "./message-body";
import { SenderAvatar } from "./sender-avatar";

type MessageViewProps = {
  activeMailbox: MailboxCategory;
  message: MessageListItem;
  onMarkThreadAsRead?: (threadId: string) => void | Promise<void>;
  onMarkThreadAsUnread?: (threadId: string) => void | Promise<void>;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onUpdateLabels?: (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
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

  return (
    <div className={cn("flex gap-4", preview ? "items-start" : "items-center", className)}>
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
                  isExpanded || isMessageUnread(message)
                    ? "font-semibold text-foreground-dark"
                    : "font-medium",
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
          expanded ? "translate-y-0 pt-2 opacity-100" : "-translate-y-1 pt-0 opacity-0",
        )}
      >
        <div className="border-t border-border/60 pt-4 sm:pt-5">
          <MessageBody
            compact={compact}
            html={message.bodyHtml}
            snippet={message.snippet}
            text={message.bodyText}
          />
        </div>
      </div>
    </div>
  </div>
);

export const MessageView = ({
  activeMailbox,
  isActionPending,
  message,
  onDeletePermanently,
  onMarkAsRead,
  onMarkAsUnread,
  onMarkThreadAsRead,
  onMarkThreadAsUnread,
  onMoveToTrash,
  onUpdateLabels,
}: MessageViewProps) => {
  const threadQuery = useSuspenseQuery(
    getThreadWithDetailsOptions(activeMailbox, message.threadId),
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

  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedMessageId(messages.length > 1 ? (messages[0]?.id ?? null) : null);
  }, [message.threadId]);

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
            onDeletePermanently={onDeletePermanently}
            onMarkAsRead={(messageId) => {
              void (onMarkThreadAsRead?.(message.threadId) ?? onMarkAsRead?.(messageId));
            }}
            onMarkAsUnread={(messageId) => {
              void (onMarkThreadAsUnread?.(message.threadId) ?? onMarkAsUnread?.(messageId));
            }}
            onMoveToTrash={onMoveToTrash}
            onUpdateLabels={onUpdateLabels}
          />
        </div>

        {!isSingleMessageThread ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </p>
        ) : null}

        <MessageAttachments attachments={threadAttachments} className="mt-4" />
      </header>

      {!isSingleMessageThread ? (
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
                    "bg-background hover:bg-muted/30":
                      !isExpanded && !isMessageUnread(threadMessage),
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
                          isExpanded && "rotate-180 text-foreground/80",
                        )}
                        icon={ArrowDown01Icon}
                      />
                    }
                  />
                </button>

                <div id={`message-body-${threadMessage.id}`}>
                  <ThreadMessageBody compact expanded={isExpanded} message={threadMessage} />
                </div>
              </section>
            );
          })}
        </div>
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
              <div className="border-t border-border/60 pt-4 sm:pt-5">
                <MessageBody
                  compact
                  html={threadMessage.bodyHtml}
                  snippet={threadMessage.snippet}
                  text={threadMessage.bodyText}
                />
              </div>
            </div>
          </section>
        ))
      )}
    </article>
  );
};
