"use client";

import { useState } from "react";
import type { GmailThreadToolResult } from "../../../types";
import { formatMessageDate } from "../../../domain/chat-formatting";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import { ToolStep } from "./tool-step";

type ThreadToolProps = {
  nested?: boolean;
  data?: GmailThreadToolResult;
  error?: string | null;
  onOpenMessage: (category: GmailThreadToolResult["category"], messageId: string) => void;
  pending: boolean;
  threadId?: string;
};

export const ThreadTool = ({
  nested = false,
  data,
  error,
  onOpenMessage,
  pending,
  threadId,
}: ThreadToolProps) => {
  const [expanded, setExpanded] = useState(false);
  const success = data?.status === "success" ? data : null;
  const messageCount = success ? success.messages.length + success.omittedMessageCount : 0;
  const detailSource = success?.subject || threadId;
  const detail = detailSource ? `"${truncateToolDetail(detailSource)}"` : undefined;
  const meta = pending
    ? undefined
    : error
      ? undefined
      : success
        ? `${messageCount} message${messageCount === 1 ? "" : "s"}`
        : undefined;

  return (
    <ToolStep
      nested={nested}
      detail={detail}
      error={error}
      expandable={!!success && success.messages.length > 0}
      expanded={expanded}
      label={pending ? "Reading thread" : "Read thread"}
      meta={meta}
      onToggle={() => setExpanded((current) => !current)}
      pending={pending}
    >
      {success ? (
        <div className="space-y-2">
          {success.omittedMessageCount > 0 ? (
            <p className="text-[11px] text-muted-foreground/75">
              {success.omittedMessageCount} earlier message
              {success.omittedMessageCount === 1 ? "" : "s"} hidden
            </p>
          ) : null}
          {success.messages.slice(-4).map((message) => (
            <button
              className="block w-full rounded-sm text-left transition-colors hover:text-foreground"
              key={message.id}
              onClick={() => onOpenMessage(success.category, message.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span className="truncate text-foreground/80">{message.from || "Unknown"}</span>
                {message.date ? (
                  <span className="shrink-0 tabular-nums">{formatMessageDate(message.date)}</span>
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-3 text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
                {message.body || message.snippet || "(No content)"}
                {message.bodyTruncated ? "…" : ""}
              </p>
            </button>
          ))}
        </div>
      ) : null}
    </ToolStep>
  );
};
