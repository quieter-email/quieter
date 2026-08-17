"use client";

import { truncateToolDetail } from "../../../domain/tool-summaries";
import type { GmailMessagesToolResult } from "../../../types";
import type { ToolIcon } from "./tool-icons";
import { ToolStep } from "./tool-step";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type MessagesToolProps = {
  active?: boolean;
  icon?: ToolIcon;
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
  active,
  icon,
  data,
  error,
  nested = false,
  onOpenMessage,
  pending,
  requestedCount,
}: MessagesToolProps) => {
  const success = data?.status === "success" ? data : null;
  const count = success?.messages.length ?? requestedCount;
  const detail =
    count === undefined
      ? undefined
      : `${count} message${count === 1 ? "" : "s"}`;

  return (
    <ToolStep
      active={active}
      icon={icon}
      detail={detail}
      error={error}
      expandable={success !== null && success.messages.length > 0}
      label={pending ? "Reading messages" : "Read messages"}
      meta={
        success !== null && success.failed.length > 0
          ? `${success.failed.length} unavailable`
          : undefined
      }
      nested={nested}
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
