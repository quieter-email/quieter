"use client";

import { Copy01Icon, Edit02Icon } from "@hugeicons/core-free-icons";
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
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import type { UIMessage } from "ai";
import { useState } from "react";

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

const EditMessage = ({
  disabled,
  onEdit,
  text,
}: {
  disabled: boolean;
  onEdit: (text: string) => void;
  text: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const revisedText = draft?.trim() ?? "";
  const canSend =
    !disabled && revisedText !== "" && revisedText !== text.trim();

  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        setDraft(open ? text : null);
      }}
    >
      <IconButtonTooltip label="Edit message">
        <DialogTrigger
          aria-label="Edit message"
          disabled={disabled}
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <Icon aria-hidden icon={Edit02Icon} size={14} />
        </DialogTrigger>
      </IconButtonTooltip>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) {
              setDraft(null);
              onEdit(revisedText);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit message</DialogTitle>
            <DialogDescription>
              Start a new conversation from this message. The original stays in
              your history.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Textarea
              aria-label="Edited message"
              maxLength={10_000}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              value={draft ?? text}
              variant="composer"
            />
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton>Cancel</DialogCloseButton>
            <Button disabled={!canSend} type="submit">
              Send in new chat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const ChatMessage = ({
  approvals,
  edit,
  isStreaming,
  message,
  onSuggestion,
}: {
  approvals: ChatToolApproval[];
  edit?: {
    disabled: boolean;
    onSubmit: (messageId: string, text: string) => void;
  };
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
      <div className="group/message flex items-center justify-end gap-1">
        {edit === undefined ? null : (
          <div className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
            <EditMessage
              disabled={edit.disabled}
              onEdit={(value) => {
                edit.onSubmit(message.id, value);
              }}
              text={text}
            />
          </div>
        )}
        <Surface
          chrome="bubble"
          className="max-w-2/3"
          data-conversation-item={message.id}
          padding="snug"
          variant="section"
        >
          <Text className="wrap-anywhere whitespace-pre-wrap">{text}</Text>
        </Surface>
      </div>
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
