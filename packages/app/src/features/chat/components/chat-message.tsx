"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { MarkdownContent } from "@quieter/app/features/chat/components/markdown-content";
import { ToolActivity } from "@quieter/app/features/chat/components/tool-activity";
import {
  getAssistantProgress,
  getMessageSuggestions,
  getMessageText,
} from "@quieter/app/features/chat/domain/chat-messages";
import type { ChatToolApproval } from "@quieter/app/features/chat/domain/chat-tools";
import { getChatActivitySegments } from "@quieter/app/features/chat/domain/tool-activity";
import { toastError } from "@quieter/app/lib/error-toast";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import type { UIMessage } from "ai";

const copyMessage = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  } catch (error) {
    toastError(error, {
      boundary: "assistant-copy",
      fallback: "Could not copy to clipboard.",
    });
  }
};

export const ChatMessage = ({
  approvals,
  isStreaming,
  message,
  onSuggestion,
}: {
  approvals: ChatToolApproval[];
  isStreaming: boolean;
  message: UIMessage;
  onSuggestion?: (text: string) => void;
}) => {
  const text = getMessageText(message.parts);

  if (message.role === "system" || (message.role === "user" && text === "")) {
    return null;
  }

  if (message.role === "user") {
    return (
      <Surface
        chrome="bubble"
        className="max-w-2/3 self-end"
        data-conversation-item={message.id}
        padding="snug"
        variant="section"
      >
        <Text className="wrap-anywhere whitespace-pre-wrap">{text}</Text>
      </Surface>
    );
  }

  const segments = getChatActivitySegments({ approvals, parts: message.parts });
  const activeWork = segments.some(
    (segment) =>
      segment.kind === "approval" ||
      (segment.kind === "activity" &&
        segment.steps.some((step) => step.phase === "running"))
  );
  const showThinking =
    !activeWork && getAssistantProgress(message.parts, isStreaming) !== null;
  const suggestions = getMessageSuggestions(message.parts);

  return (
    <article className="group/message w-full min-w-0 space-y-3 text-body text-fg">
      {segments.map((segment) => {
        if (segment.kind === "text") {
          return (
            <MarkdownContent
              key={`${message.id}:${segment.id}`}
              markdown={segment.text}
            />
          );
        }
        return (
          <ToolActivity
            activity={segment}
            isStreaming={isStreaming}
            key={segment.id}
          />
        );
      })}
      {showThinking ? (
        <Text aria-live="polite" size="sm" tone="muted">
          Thinking…
        </Text>
      ) : null}
      {onSuggestion !== undefined &&
      !isStreaming &&
      !activeWork &&
      text !== "" &&
      suggestions.length > 0 ? (
        <div
          aria-label="Suggested replies"
          className="flex animate-in flex-wrap gap-2 pt-3 duration-(--app-motion-duration-feedback) fade-in motion-reduce:animate-none"
        >
          {suggestions.map((suggestion) => (
            <Button
              className="max-w-full"
              key={suggestion.text}
              onClick={() => {
                onSuggestion(suggestion.text);
              }}
              size="sm"
              title={suggestion.text}
              type="button"
              variant="secondary"
            >
              <span className="truncate">{suggestion.label}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {!isStreaming && text !== "" ? (
        <div className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
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
              <Icon aria-hidden size={14} icon={Copy01Icon} />
            </Button>
          </IconButtonTooltip>
        </div>
      ) : null}
    </article>
  );
};
