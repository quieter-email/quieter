"use client";

import { useState } from "react";

import { truncateToolDetail } from "../../../domain/tool-summaries";
import type { GmailMessagesToolResult } from "../../../types";
import { ToolStep } from "./tool-step";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type MessagesToolProps = {
  data?: GmailMessagesToolResult;
  error?: string | null;
  nested?: boolean;
  onOpenMessage: (
    category: Extract<
      GmailMessagesToolResult,
      { status: "success" }
    >["messages"][number]["category"],
    messageId: string
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
  const detail =
    count === undefined
      ? undefined
      : `${count} message${count === 1 ? "" : "s"}`;

  return (
    <ToolStep
      detail={detail}
      error={error}
      expandable={success !== null && success.messages.length > 0}
      expanded={expanded}
      label={pending ? "Reading messages" : "Read messages"}
      meta={
        success !== null && success.failed.length > 0
          ? `${success.failed.length} unavailable`
          : undefined
      }
      nested={nested}
      onToggle={() => {
        setExpanded((current) => !current);
      }}
      pending={pending}
    >
      {success ? (
        <div className="space-y-1.5">
          {success.messages.map((message) => (
            <button
              className="block w-full rounded-sm text-left text-xs text-muted-fg transition-colors hover:text-fg"
              key={message.id}
              onClick={() => {
                onOpenMessage(message.category, message.id);
              }}
              type="button"
            >
              <span className="block truncate text-fg/80">
                {hasText(message.subject)
                  ? truncateToolDetail(message.subject, 70)
                  : "(No subject)"}
              </span>
              {hasText(message.from) ? (
                <span className="block truncate">{message.from}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </ToolStep>
  );
};
