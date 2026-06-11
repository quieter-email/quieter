"use client";

import { useState } from "react";
import type { GmailMessageToolResult } from "../../../types";
import { formatMessageDate } from "../../../domain/chat-formatting";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import { ToolStep } from "./tool-step";

type MessageToolProps = {
  nested?: boolean;
  data?: GmailMessageToolResult;
  error?: string | null;
  onOpenMessage: (category: GmailMessageToolResult["category"], messageId: string) => void;
  pending: boolean;
};

export const MessageTool = ({
  nested = false,
  data,
  error,
  onOpenMessage,
  pending,
}: MessageToolProps) => {
  const [expanded, setExpanded] = useState(false);
  const success = data?.status === "success" ? data : null;
  const detail = success?.subject ? `"${truncateToolDetail(success.subject)}"` : undefined;
  const meta = pending
    ? undefined
    : error
      ? undefined
      : success
        ? [success.from, success.date ? formatMessageDate(success.date) : null]
            .filter(Boolean)
            .join(" · ")
        : undefined;

  return (
    <ToolStep
      nested={nested}
      detail={detail}
      error={error}
      expandable={!!success}
      expanded={expanded}
      label={pending ? "Reading message" : "Read message"}
      meta={meta}
      onToggle={() => setExpanded((current) => !current)}
      pending={pending}
    >
      {success ? (
        <button
          className="block w-full rounded-sm text-left transition-colors hover:text-foreground"
          onClick={() => onOpenMessage(success.category, success.id)}
          type="button"
        >
          <p className="text-[11px] text-muted-foreground">
            {success.to ? `To ${success.to}` : null}
            {success.attachmentCount > 0
              ? `${success.to ? " · " : ""}${success.attachmentCount} attachment${success.attachmentCount === 1 ? "" : "s"}`
              : null}
          </p>
          <p className="mt-1 text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
            {success.body || success.snippet || "(No content)"}
            {success.bodyTruncated ? "…" : ""}
          </p>
        </button>
      ) : null}
    </ToolStep>
  );
};
