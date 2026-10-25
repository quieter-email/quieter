"use client";

import { Alert02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { ChatMessage } from "@quieter/app/features/chat/components/chat-message";
import type { ChatToolApproval } from "@quieter/app/features/chat/domain/chat-tools";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

type ChatTranscriptProps = {
  approvals: ChatToolApproval[];
  docked: boolean;
  errorMessage?: string;
  isStreaming: boolean;
  messages: UIMessage[];
  onRetry?: () => void;
  onSuggestion?: (text: string) => void;
};

const SCROLL_THRESHOLD = 120;

export const ChatTranscript = ({
  approvals,
  docked,
  errorMessage,
  isStreaming,
  messages,
  onRetry,
  onSuggestion,
}: ChatTranscriptProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [showLatest, setShowLatest] = useState(false);

  const scrollToLatest = (behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    viewport.scrollTo({ behavior, top: viewport.scrollHeight });
    setShowLatest(false);
  };

  useEffect(() => {
    const content = contentRef.current;
    if (content === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const viewport = viewportRef.current;
      if (
        viewport !== null &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          SCROLL_THRESHOLD
      ) {
        scrollToLatest("auto");
      }
    });
    observer.observe(content);
    scrollToLatest("auto");
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={cn("relative flex min-h-0 flex-col", {
        "flex-1": docked,
        "max-h-[min(28rem,calc(100dvh-15rem))]": !docked,
      })}
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={() => {
          const viewport = viewportRef.current;
          if (viewport === null) {
            return;
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
              isStreaming={isStreaming && message === messages.at(-1)}
              key={message.id}
              message={message}
              onSuggestion={
                message === messages.at(-1) ? onSuggestion : undefined
              }
            />
          ))}
          {errorMessage === undefined || errorMessage === "" ? null : (
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
          )}
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
                scrollToLatest("smooth");
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
