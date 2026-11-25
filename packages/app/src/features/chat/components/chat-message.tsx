"use client";

import { Copy01Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { ToolActivity } from "@quieter/app/features/chat/components/tool-activity";
import {
  getAssistantProgress,
  getMessageSuggestions,
  getMessageText,
} from "@quieter/app/features/chat/domain/chat-messages";
import type { ChatToolApproval } from "@quieter/app/features/chat/domain/chat-tools";
import { getChatActivitySegments } from "@quieter/app/features/chat/domain/tool-activity";
import { toastError } from "@quieter/app/lib/error-toast";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { entranceMotionVariants } from "@quieter/ui/motion";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import type { UIMessage } from "ai";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export const preloadChatMarkdown = async () => {
  const { MarkdownContent } = await import("./markdown-content");
  return { default: MarkdownContent };
};

const MarkdownContent = lazy(preloadChatMarkdown);

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

export const ChatEntry = ({
  animateOnMount,
  children,
}: {
  animateOnMount: boolean;
  children: ReactNode;
}) => {
  // oxlint-disable-next-line react/hook-use-state -- Intentionally frozen at mount; there is no setter.
  const [entering] = useState(animateOnMount);
  return (
    <div
      className={cn({
        "animate-in duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out) fade-in slide-in-from-bottom-1 motion-reduce:animate-none":
          entering,
      })}
    >
      {children}
    </div>
  );
};

type MessageEdit = {
  disabled: boolean;
  onSubmit: (messageId: string, text: string) => void;
};

const UserMessage = ({
  edit,
  messageId,
  text,
}: {
  edit?: MessageEdit;
  messageId: string;
  text: string;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const restoreEditFocus = useRef(false);
  const focusEditor = useCallback((textarea: HTMLTextAreaElement | null) => {
    textarea?.focus();
  }, []);
  const cancelEdit = () => {
    restoreEditFocus.current = true;
    setDraft(null);
  };
  const handleEditKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  };
  const editing = edit !== undefined && draft !== null;
  const revisedText = draft?.trim() ?? "";
  const canSend =
    editing &&
    !edit.disabled &&
    revisedText !== "" &&
    revisedText !== text.trim();

  return (
    <div className="group/message flex items-center justify-end gap-1">
      {edit !== undefined && !editing ? (
        <div className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
          <IconButtonTooltip label="Edit message">
            <Button
              aria-label="Edit message"
              disabled={edit.disabled}
              onClick={() => {
                setDraft(text);
              }}
              ref={(button: HTMLButtonElement | null) => {
                if (button !== null && restoreEditFocus.current) {
                  restoreEditFocus.current = false;
                  button.focus({ preventScroll: true });
                }
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Icon aria-hidden icon={Edit02Icon} size={14} />
            </Button>
          </IconButtonTooltip>
        </div>
      ) : null}
      <Surface
        chrome="bubble"
        className={cn({
          "max-w-2/3": !editing,
          "w-full max-w-sm": editing,
        })}
        data-conversation-item={messageId}
        padding="snug"
        variant="section"
      >
        {editing ? (
          <form
            data-chat-message-editor=""
            onSubmit={(event) => {
              event.preventDefault();
              if (canSend) {
                setDraft(null);
                edit.onSubmit(messageId, revisedText);
              }
            }}
          >
            <Textarea
              aria-label="Edited message"
              maxLength={10_000}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={handleEditKeyDown}
              ref={focusEditor}
              value={draft}
              variant="composer"
            />
            <div
              // oxlint-disable-next-line shadcn/no-arbitrary-values -- Expanding the footer's grid track moves the messages below in normal flow.
              className="grid grid-rows-[1fr] duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out) motion-safe:transition-[grid-template-rows] motion-safe:starting:grid-rows-[0fr]"
            >
              <div
                className={cn(
                  "min-h-0 overflow-clip",
                  entranceMotionVariants({ effect: "pop" })
                )}
              >
                <ActionFooter className="mt-2">
                  <Button
                    focusRing="inset"
                    onClick={cancelEdit}
                    onKeyDown={handleEditKeyDown}
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={!canSend}
                    focusRing="inset"
                    onKeyDown={handleEditKeyDown}
                    type="submit"
                  >
                    Submit
                  </Button>
                </ActionFooter>
              </div>
            </div>
          </form>
        ) : (
          <Text className="wrap-anywhere whitespace-pre-wrap">{text}</Text>
        )}
      </Surface>
    </div>
  );
};

export const ChatMessage = ({
  approvals,
  edit,
  entering = false,
  isStreaming,
  message,
  onSuggestion,
}: {
  approvals: ChatToolApproval[];
  edit?: MessageEdit;
  entering?: boolean;
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
      <ChatEntry animateOnMount={entering}>
        <UserMessage edit={edit} messageId={message.id} text={text} />
      </ChatEntry>
    );
  }

  const segments = getChatActivitySegments({ approvals, parts: message.parts });
  const activeWork = segments.some(
    (segment) =>
      segment.kind === "approval" ||
      (segment.kind === "activity" &&
        segment.steps.some((step) => step.phase === "running"))
  );
  const progress = activeWork
    ? null
    : getAssistantProgress(message.parts, isStreaming);
  const interruption = message.parts.findLast(
    (part) => part.type === "data-chat-interruption"
  );
  const interruptionText =
    interruption?.type === "data-chat-interruption" &&
    typeof interruption.data === "string"
      ? interruption.data
      : undefined;
  if (
    segments.length === 0 &&
    progress === null &&
    interruptionText === undefined &&
    text === ""
  ) {
    return null;
  }
  const suggestions = getMessageSuggestions(message.parts);

  return (
    <article className="group/message w-full min-w-0 space-y-3 text-body text-fg">
      {segments.map((segment) => (
        <ChatEntry
          animateOnMount={isStreaming}
          key={
            segment.kind === "text" ? `${message.id}:${segment.id}` : segment.id
          }
        >
          {segment.kind === "text" ? (
            <Suspense
              fallback={
                <Text className="wrap-anywhere whitespace-pre-wrap" size="body">
                  {segment.text}
                </Text>
              }
            >
              <MarkdownContent markdown={segment.text} />
            </Suspense>
          ) : (
            <ToolActivity activity={segment} isStreaming={isStreaming} />
          )}
        </ChatEntry>
      ))}
      {interruptionText === undefined ? null : (
        <Text aria-live="polite" size="sm" tone="muted">
          {interruptionText}
        </Text>
      )}
      {progress === null ? null : (
        <output className="status-shimmer flex w-fit">
          <Text as="span" size="sm" tone="muted">
            {progress}
          </Text>
        </output>
      )}
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
