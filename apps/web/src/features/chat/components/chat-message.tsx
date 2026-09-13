"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { toast } from "@quieter/ui/toast";
import type { UIMessage } from "ai";

import { getAssistantProgress, getMessageText } from "../domain/chat-messages";
import { isChatToolPart } from "../domain/chat-tools";
import type { ChatToolApproval } from "../domain/chat-tools";
import { MarkdownContent } from "./markdown-content";
import { ToolActivity } from "./tool-activity";

const copyMessage = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

export const ChatMessage = ({
  approvals,
  isStreaming,
  message,
}: {
  approvals: ChatToolApproval[];
  isStreaming: boolean;
  message: UIMessage;
}) => {
  const text = getMessageText(message.parts);

  if (message.role === "system" || (message.role === "user" && text === "")) {
    return null;
  }

  if (message.role === "user") {
    return <p className="text-body/relaxed text-muted-fg">{text}</p>;
  }

  const approvalsByToolCall = new Map(
    approvals.map((approval) => [approval.toolCallId, approval] as const)
  );
  const progress = getAssistantProgress(message.parts, isStreaming);

  return (
    <article className="group/message min-w-0 space-y-1 text-body/relaxed text-fg">
      {message.parts.map((part, index) => {
        if (part.type === "text" && part.text.trim() !== "") {
          return (
            <MarkdownContent
              // oxlint-disable-next-line react/no-array-index-key -- SDK text parts are append-only and have no IDs.
              key={`${message.id}:text:${index}`}
              markdown={part.text}
            />
          );
        }
        if (isChatToolPart(part)) {
          return (
            <ToolActivity
              approval={approvalsByToolCall.get(part.toolCallId)}
              isStreaming={isStreaming}
              key={part.toolCallId}
              part={part}
            />
          );
        }
        return null;
      })}
      {progress === null ? null : (
        <p aria-live="polite" className="text-caption text-muted-fg">
          {progress}
        </p>
      )}
      {!isStreaming && text !== "" ? (
        <div className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
          <IconButtonTooltip label="Copy response">
            <Button
              aria-label="Copy response"
              onClick={() => {
                void copyMessage(text);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5"
                icon={Copy01Icon}
              />
            </Button>
          </IconButtonTooltip>
        </div>
      ) : null}
    </article>
  );
};
