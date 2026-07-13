"use client";

import { useState } from "react";
import type { GmailMessagesToolResult } from "../../../types";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import { ToolStep } from "./tool-step";

type MessagesToolProps = {
  data?: GmailMessagesToolResult;
  error?: string | null;
  nested?: boolean;
  onOpenMessage: (
    category: Extract<
      GmailMessagesToolResult,
      { status: "success" }
    >["messages"][number]["category"],
    messageId: string,
  ) => void;
  pending: boolean;
  requestedCount?: number;
};

export const MessagesTool = ({
  data,
  error,
  nested = false,
  onOpenMessage,
  pending,
  requestedCount,
}: MessagesToolProps) => {
  const [expanded, setExpanded] = useState(false);
  const success = data?.status === "success" ? data : null;
  const count = success?.messages.length ?? requestedCount;
  const detail = count === undefined ? undefined : `${count} message${count === 1 ? "" : "s"}`;

  return (
    <ToolStep
      detail={detail}
      error={error}
      expandable={!!success?.messages.length}
      expanded={expanded}
      label={pending ? "Reading messages" : "Read messages"}
      meta={success?.failed.length ? `${success.failed.length} unavailable` : undefined}
      nested={nested}
      onToggle={() => setExpanded((current) => !current)}
      pending={pending}
    >
      {success ? (
        <div className="space-y-1.5">
          {success.messages.map((message) => (
            <button
              className="block w-full rounded-sm text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              key={message.id}
              onClick={() => onOpenMessage(message.category, message.id)}
              type="button"
            >
              <span className="block truncate text-foreground/80">
                {message.subject ? truncateToolDetail(message.subject, 70) : "(No subject)"}
              </span>
              {message.from ? <span className="block truncate">{message.from}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </ToolStep>
  );
};
