"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { toast } from "@quieter/ui/toast";
import type { UIMessage } from "@tanstack/ai";
import type { ReactNode } from "react";

import { getAssistantProgress, getMessageText } from "../domain/chat-messages";
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
  resuming,
}: {
  approvals: ChatToolApproval[];
  isStreaming: boolean;
  message: UIMessage;
  resuming: boolean;
}) => {
  const text = getMessageText(message.parts);

  if (message.role === "system" || (message.role === "user" && !text)) {
    return null;
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-body/relaxed whitespace-pre-wrap text-fg sm:max-w-[75%]">
          {text}
        </p>
      </div>
    );
  }

  const toolResults = new Map(
    message.parts.flatMap((part) =>
      part.type === "tool-result" ? [[part.toolCallId, part] as const] : []
    )
  );
  const approvalsByCall = new Map(
    approvals.map((approval) => [approval.toolCallId, approval] as const)
  );
  const hasToolCalls = message.parts.some((part) => part.type === "tool-call");
  const progress = hasToolCalls
    ? null
    : getAssistantProgress(message.parts, isStreaming);
  if (!text && progress === null && !hasToolCalls) {
    return null;
  }

  // Parts are append-only while streaming, so a per-message text ordinal is the
  // only stable identity; keying on content would remount on every delta.
  const renderedParts: ReactNode[] = [];
  let textOrdinal = 0;
  for (const part of message.parts) {
    if (part.type === "text" && part.content.trim() !== "") {
      textOrdinal += 1;
      renderedParts.push(
        <MarkdownContent
          isStreaming={isStreaming}
          key={`${message.id}:text:${textOrdinal}`}
          markdown={part.content}
        />
      );
    } else if (part.type === "tool-call") {
      const approval = approvalsByCall.get(part.id);
      renderedParts.push(
        <ToolActivity
          {...(approval === undefined ? {} : { approval })}
          call={part}
          isStreaming={isStreaming}
          key={part.id}
          result={toolResults.get(part.id)}
          resuming={resuming}
        />
      );
    }
  }

  return (
    <article className="group/message min-w-0 text-fg">
      <div className="space-y-2">{renderedParts}</div>
      {progress ? (
        <p aria-live="polite" className="mt-2 text-body text-muted-fg">
          {progress}
        </p>
      ) : null}
      {!isStreaming && text ? (
        <div className="mt-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
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
              <HugeiconsIcon aria-hidden icon={Copy01Icon} />
            </Button>
          </IconButtonTooltip>
        </div>
      ) : null}
    </article>
  );
};
