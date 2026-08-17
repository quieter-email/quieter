"use client";

import { formatMessageDate } from "../../../domain/chat-formatting";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import type { GmailThreadToolResult } from "../../../types";
import type { ToolIcon } from "./tool-icons";
import { ToolStep } from "./tool-step";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type ThreadToolProps = {
  active?: boolean;
  icon?: ToolIcon;
  nested?: boolean;
  data?: GmailThreadToolResult;
  error?: string | null;
  onOpenMessage: (
    category: GmailThreadToolResult["category"],
    messageId: string
  ) => void;
  pending: boolean;
  threadId?: string;
};

export const ThreadTool = ({
  active,
  icon,
  nested = false,
  data,
  error,
  onOpenMessage,
  pending,
  threadId,
}: ThreadToolProps) => {
  const success = data?.status === "success" ? data : null;
  const messageCount = success
    ? success.messages.length + success.omittedMessageCount
    : 0;
  const detailSource = success?.subject?.trim() ?? threadId;
  const detail = hasText(detailSource)
    ? `"${truncateToolDetail(detailSource)}"`
    : undefined;
  let meta: string | undefined;
  if (pending || hasText(error)) {
    meta = undefined;
  } else if (success !== null) {
    meta = `${messageCount} message${messageCount === 1 ? "" : "s"}`;
  }

  return (
    <ToolStep
      active={active}
      icon={icon}
      nested={nested}
      detail={detail}
      error={error}
      expandable={!!success && success.messages.length > 0}
      label={pending ? "Reading thread" : "Read thread"}
      meta={meta}
      pending={pending}
    >
      {success ? (
        <div className="space-y-2">
          {success.omittedMessageCount > 0 ? (
            <p className="text-micro text-muted-fg/75">
              {success.omittedMessageCount} earlier message
              {success.omittedMessageCount === 1 ? "" : "s"} hidden
            </p>
          ) : null}
          {success.messages.slice(-4).map((message) => (
            <button
              className="block w-full rounded-sm text-left transition-colors hover:text-fg"
              key={message.id}
              onClick={() => {
                onOpenMessage(success.category, message.id);
              }}
              type="button"
            >
              <div className="flex items-center justify-between gap-3 text-micro text-muted-fg">
                <span className="truncate text-fg/80">
                  {message.from?.trim() ?? "Unknown"}
                </span>
                {message.date !== null && message.date !== undefined ? (
                  <span className="shrink-0 tabular-nums">
                    {formatMessageDate(message.date)}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-3 text-xs/relaxed whitespace-pre-wrap text-muted-fg">
                {message.body?.trim() ??
                  message.snippet?.trim() ??
                  "(No content)"}
                {message.bodyTruncated ? "…" : ""}
              </p>
            </button>
          ))}
        </div>
      ) : null}
    </ToolStep>
  );
};
