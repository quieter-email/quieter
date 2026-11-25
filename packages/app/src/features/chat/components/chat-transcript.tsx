"use client";

import { Alert02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import {
  ChatEntry,
  ChatMessage,
} from "@quieter/app/features/chat/components/chat-message";
import { hasAssistantContent } from "@quieter/app/features/chat/domain/chat-messages";
import type { ChatToolApproval } from "@quieter/app/features/chat/domain/chat-tools";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Text } from "@quieter/ui/text";
import type { UIMessage } from "ai";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

type ChatTranscriptProps = {
  approvals: ChatToolApproval[];
  completedAssistantMessageId?: string | null;
  docked: boolean;
  edit?: ComponentProps<typeof ChatMessage>["edit"];
  errorMessage?: string;
  isStreaming: boolean;
  messages: UIMessage[];
  newUserMessageId?: string | null;
  onRetry?: () => void;
  onSuggestion?: (text: string) => void;
  requestPending?: boolean;
};

const SCROLL_THRESHOLD = 120;

export const ChatTranscript = ({
  approvals,
  completedAssistantMessageId = null,
  docked,
  edit,
  errorMessage,
  isStreaming,
  messages,
  newUserMessageId = null,
  onRetry,
  onSuggestion,
  requestPending = false,
}: ChatTranscriptProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previousViewport = useRef<{
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const reducedMotion = useReducedMotion();
  const [showLatest, setShowLatest] = useState(false);
  const lastMessage = messages.at(-1);
  const hasError = errorMessage !== undefined && errorMessage !== "";
  const awaitingResponse =
    (requestPending || isStreaming) &&
    !hasError &&
    !(
      lastMessage?.role === "assistant" &&
      hasAssistantContent(lastMessage.parts)
    );

  const scrollToLatest = (behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    viewport.scrollTo({ behavior, top: viewport.scrollHeight });
    previousViewport.current = {
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    };
    setShowLatest(false);
  };

  useEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (content === null || viewport === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const previous = previousViewport.current;
      const wasFollowing =
        previous === null ||
        previous.scrollHeight - previous.scrollTop - previous.clientHeight <
          SCROLL_THRESHOLD;
      previousViewport.current = {
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
      if (
        wasFollowing &&
        viewport.querySelector("[data-chat-message-editor]:focus-within") ===
          null
      ) {
        scrollToLatest("auto");
      }
    });
    observer.observe(content);
    observer.observe(viewport);
    scrollToLatest("auto");
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={cn("relative flex min-h-0", {
        "flex-1": docked,
        "max-h-[min(28rem,calc(100dvh-15rem))]": !docked,
      })}
    >
      <div
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={() => {
          const viewport = viewportRef.current;
          if (viewport === null) {
            return;
          }
          const previous = previousViewport.current;
          if (
            previous !== null &&
            previous.clientHeight === viewport.clientHeight &&
            previous.scrollHeight === viewport.scrollHeight
          ) {
            previous.scrollTop = viewport.scrollTop;
          }
          setShowLatest(
            viewport.scrollHeight -
              viewport.scrollTop -
              viewport.clientHeight >=
              SCROLL_THRESHOLD
          );
        }}
        ref={viewportRef}
      >
        <div className="flex w-full flex-col gap-4 p-4" ref={contentRef}>
          {messages.map((message) => (
            <ChatMessage
              approvals={approvals}
              edit={edit}
              entering={message.id === newUserMessageId}
              isStreaming={isStreaming && message === lastMessage}
              key={message.id}
              message={message}
              onSuggestion={
                message === lastMessage &&
                message.id === completedAssistantMessageId &&
                !isStreaming
                  ? onSuggestion
                  : undefined
              }
            />
          ))}
          {awaitingResponse ? (
            <ChatEntry animateOnMount>
              <output className="status-shimmer flex w-fit">
                <Text as="span" size="sm" tone="muted">
                  Getting a response…
                </Text>
              </output>
            </ChatEntry>
          ) : null}
          {hasError ? (
            <div className="flex items-start gap-2" role="alert">
              <Icon
                aria-hidden
                tone="destructive"
                className="mt-0.5"
                icon={Alert02Icon}
              />
              <p className="min-w-0 flex-1 text-body-sm text-destructive">
                {errorMessage}
              </p>
              {onRetry === undefined ? null : (
                <Button
                  onClick={onRetry}
                  size="compact"
                  type="button"
                  variant="ghost"
                >
                  Try again
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {showLatest ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <IconButtonTooltip label="Scroll to latest message">
            <Button
              aria-label="Scroll to latest message"
              // oxlint-disable-next-line shadcn/no-restyle -- Floating scroll button keeps its elevated treatment.
              className="pointer-events-auto rounded-full bg-bg-raised shadow-elevation"
              onClick={() => {
                scrollToLatest(reducedMotion === true ? "auto" : "smooth");
              }}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <Icon aria-hidden size={14} icon={ArrowDown01Icon} />
            </Button>
          </IconButtonTooltip>
        </div>
      ) : null}
    </div>
  );
};
