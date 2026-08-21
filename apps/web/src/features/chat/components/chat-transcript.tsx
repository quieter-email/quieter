"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import type { UIMessage } from "@tanstack/ai";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { ChatToolApproval } from "../domain/chat-tools";
import { ChatMessage } from "./chat-message";

type ChatTranscriptProps = {
  approvals: ChatToolApproval[];
  errorMessage?: string;
  isStreaming: boolean;
  messages: UIMessage[];
  onRetry: () => void;
  resuming: boolean;
};

const SCROLL_THRESHOLD = 120;

export const ChatTranscript = ({
  approvals,
  errorMessage,
  isStreaming,
  messages,
  onRetry,
  resuming,
}: ChatTranscriptProps) => {
  const shouldReduceMotion = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    isNearBottomRef.current = true;
    setShowScrollButton(false);
    viewport.scrollTo({ behavior, top: viewport.scrollHeight });
  };

  useEffect((): (() => void) | undefined => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        scrollToBottom(shouldReduceMotion === true ? "auto" : "smooth");
      }
    });

    resizeObserver.observe(content);
    scrollToBottom("auto");
    return () => {
      resizeObserver.disconnect();
    };
  }, [shouldReduceMotion]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = viewport;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const scrolledUp = scrollTop < lastScrollTopRef.current - 1;

    if (distanceFromBottom < SCROLL_THRESHOLD) {
      isNearBottomRef.current = true;
    } else if (scrolledUp) {
      isNearBottomRef.current = false;
    }

    lastScrollTopRef.current = scrollTop;
    setShowScrollButton(!isNearBottomRef.current);
  };

  const lastMessage = messages.at(-1);
  const streamingAssistantId =
    isStreaming && lastMessage?.role === "assistant"
      ? lastMessage.id
      : undefined;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        className="h-full overflow-y-auto overscroll-contain"
        onScroll={handleScroll}
      >
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 pt-8 pb-12 sm:gap-10 sm:px-6 sm:pt-12"
        >
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              approvals={approvals}
              isStreaming={
                isStreaming &&
                message.role === "assistant" &&
                message.id === streamingAssistantId
              }
              message={message}
              resuming={resuming}
            />
          ))}
          {isStreaming && streamingAssistantId === undefined ? (
            <p aria-live="polite" className="text-body text-muted-fg">
              Thinking…
            </p>
          ) : null}
          {errorMessage !== undefined && errorMessage !== "" ? (
            <div
              className="flex items-center gap-3 text-body text-muted-fg"
              role="alert"
            >
              <span>{errorMessage}</span>
              <Button onClick={onRetry} size="sm" type="button" variant="ghost">
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        {showScrollButton ? (
          <IconButtonTooltip label="Scroll to latest message">
            <button
              aria-label="Scroll to latest message"
              className={cn(
                "pointer-events-auto flex size-8 items-center justify-center rounded-full border border-border bg-bg/95 text-muted-fg shadow-sm backdrop-blur-sm",
                "transition-colors hover:bg-muted hover:text-fg"
              )}
              onClick={() => {
                scrollToBottom(shouldReduceMotion === true ? "auto" : "smooth");
              }}
              type="button"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5"
                icon={ArrowDown01Icon}
              />
            </button>
          </IconButtonTooltip>
        ) : null}
      </div>
    </div>
  );
};
