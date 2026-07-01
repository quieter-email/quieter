"use client";

import { cn } from "@quieter/ui/cn";
import { useState } from "react";
import type { GmailSearchToolResult } from "../../../types";
import { formatMessageDate } from "../../../domain/chat-formatting";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import { ToolStep } from "./tool-step";

type SearchToolProps = {
  nested?: boolean;
  data?: GmailSearchToolResult;
  error?: string | null;
  onOpenMessage: (category: GmailSearchToolResult["category"], messageId: string) => void;
  pending: boolean;
  query?: string;
};

export const SearchTool = ({
  nested = false,
  data,
  error,
  onOpenMessage,
  pending,
  query,
}: SearchToolProps) => {
  const [expanded, setExpanded] = useState(false);
  const success = data?.status === "success" ? data : null;
  const messages = success?.messages ?? [];
  const meta = pending
    ? undefined
    : error
      ? undefined
      : messages.length === 0
        ? "No matches"
        : `${messages.length} result${messages.length === 1 ? "" : "s"}`;

  const detail = query ? `"${truncateToolDetail(query)}"` : undefined;

  return (
    <ToolStep
      nested={nested}
      detail={detail}
      error={error}
      expandable={!!success && messages.length > 0}
      expanded={expanded}
      label={pending ? "Searching mail" : "Searched mail"}
      meta={meta}
      onToggle={() => setExpanded((current) => !current)}
      pending={pending}
    >
      {success ? (
        <div className="space-y-0.5">
          {messages.map((message) => (
            <button
              className="flex w-full items-baseline gap-2 rounded-sm py-0.5 text-left text-xs transition-colors hover:text-foreground"
              key={message.id}
              onClick={() => onOpenMessage(success.category, message.id)}
              type="button"
            >
              <span
                className={cn("size-1 shrink-0 rounded-full", {
                  "bg-foreground/70": message.isUnread,
                  "bg-transparent": !message.isUnread,
                })}
              />
              <span className="min-w-0 flex-1 truncate text-foreground/85">
                {message.subject || "(No subject)"}
              </span>
              <span className="hidden shrink-0 truncate text-muted-foreground sm:inline sm:max-w-32">
                {message.from || "Unknown"}
              </span>
              {message.date ? (
                <span className="shrink-0 text-muted-foreground/70 tabular-nums">
                  {formatMessageDate(message.date)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </ToolStep>
  );
};
