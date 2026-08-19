"use client";

import { formatMessageDate } from "../../../domain/chat-formatting";
import { truncateToolDetail } from "../../../domain/tool-summaries";
import type { GmailMessageToolResult } from "../../../types";
import type { ToolIcon } from "./tool-icons";
import { ToolStep } from "./tool-step";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

type SuccessfulGmailMessage = Extract<
  GmailMessageToolResult,
  { status: "success" }
>;

const getSuccessfulMessage = (
  data: GmailMessageToolResult | undefined
): SuccessfulGmailMessage | null => (data?.status === "success" ? data : null);

const getMessageMeta = (
  success: SuccessfulGmailMessage | null,
  pending: boolean,
  error: string | null | undefined
) => {
  if (pending || hasText(error) || success === null) {
    return "";
  }

  return [
    hasText(success.from) ? success.from : null,
    success.date !== null && success.date !== undefined
      ? formatMessageDate(success.date)
      : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");
};

const MessageToolContent = ({
  onOpenMessage,
  success,
}: {
  onOpenMessage: MessageToolProps["onOpenMessage"];
  success: SuccessfulGmailMessage;
}) => (
  <button
    className="block w-full rounded-sm text-left transition-colors hover:text-fg"
    onClick={() => {
      onOpenMessage(success.category, success.id);
    }}
    type="button"
  >
    <p className="text-micro text-muted-fg">
      {hasText(success.to) ? (
        <span className="mr-3">To {success.to}</span>
      ) : null}
      {success.attachmentCount > 0 ? (
        <span>
          {success.attachmentCount} attachment
          {success.attachmentCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </p>
    {success.attachments.length ? (
      <p className="mt-1 truncate text-micro text-muted-fg/80">
        {success.attachments
          .map((attachment) => attachment.fileName)
          .join(", ")}
      </p>
    ) : null}
    <p className="mt-1 text-caption/relaxed whitespace-pre-wrap text-muted-fg">
      {success.body?.trim() ?? success.snippet?.trim() ?? "(No content)"}
      {success.bodyTruncated ? "…" : ""}
    </p>
  </button>
);

type MessageToolProps = {
  active?: boolean;
  icon?: ToolIcon;
  nested?: boolean;
  data?: GmailMessageToolResult;
  error?: string | null;
  onOpenMessage: (
    category: GmailMessageToolResult["category"],
    messageId: string
  ) => void;
  pending: boolean;
};

export const MessageTool = ({
  active,
  icon,
  nested = false,
  data,
  error,
  onOpenMessage,
  pending,
}: MessageToolProps) => {
  const success = getSuccessfulMessage(data);
  const detail = hasText(success?.subject)
    ? `"${truncateToolDetail(success.subject)}"`
    : undefined;
  const meta = getMessageMeta(success, pending, error);

  return (
    <ToolStep
      active={active}
      icon={icon}
      nested={nested}
      detail={detail}
      error={error}
      expandable={!!success}
      label={pending ? "Reading message" : "Read message"}
      meta={meta}
      pending={pending}
    >
      {success ? (
        <MessageToolContent onOpenMessage={onOpenMessage} success={success} />
      ) : null}
    </ToolStep>
  );
};
