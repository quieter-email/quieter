"use client";

import { cn } from "@quieter/ui/cn";

import { formatMessageDate } from "../../../domain/chat-formatting";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import type { GmailSearchToolResult } from "../../../types";
import type { ToolIcon } from "./tool-icons";
import { ToolStep } from "./tool-step";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type SearchToolProps = {
  active?: boolean;
  icon?: ToolIcon;
  nested?: boolean;
  data?: GmailSearchToolResult;
  error?: string | null;
  onOpenMessage: (
    category: GmailSearchToolResult["category"],
    messageId: string
  ) => void;
  pending: boolean;
  query?: string;
};

export const SearchTool = ({
  active,
  icon,
  nested = false,
  data,
  error,
  onOpenMessage,
  pending,
  query,
}: SearchToolProps) => {
  const success = data?.status === "success" ? data : null;
  const messages = success?.messages ?? [];
  let meta: string | undefined;
  if (pending || hasText(error)) {
    meta = undefined;
  } else if (messages.length === 0) {
    meta = "No matches";
  } else {
    meta = `${messages.length} result${messages.length === 1 ? "" : "s"}`;
  }

  const detail = hasText(query) ? `"${truncateToolDetail(query)}"` : undefined;

  return (
    <ToolStep
      active={active}
      icon={icon}
      nested={nested}
      detail={detail}
      error={error}
      expandable={!!success && messages.length > 0}
      label={pending ? "Searching mail" : "Searched mail"}
      meta={meta}
      pending={pending}
    >
      {success ? (
        <div className="space-y-0.5">
          {messages.map((message) => (
            <button
              className="flex w-full items-baseline gap-2 rounded-sm py-0.5 text-left text-caption transition-colors hover:text-fg"
              key={message.id}
              onClick={() => {
                onOpenMessage(success.category, message.id);
              }}
              type="button"
            >
              <span
                className={cn("size-1 shrink-0 rounded-full", {
                  "bg-fg/70": message.isUnread === true,
                  "bg-transparent": message.isUnread !== true,
                })}
              />
              <span className="min-w-0 flex-1 truncate text-fg/85">
                {message.subject?.trim() ?? "(No subject)"}
              </span>
              <span className="hidden shrink-0 truncate text-muted-fg sm:inline sm:max-w-32">
                {message.from?.trim() ?? "Unknown"}
              </span>
              {hasText(message.date) ? (
                <span className="shrink-0 text-muted-fg/70 tabular-nums">
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
