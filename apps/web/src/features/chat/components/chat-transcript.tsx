"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

import type { ChatToolApproval } from "../domain/chat-tools";
import { ChatMessage } from "./chat-message";

type ChatTranscriptProps = {
  approvals: ChatToolApproval[];
  errorMessage?: string;
  isStreaming: boolean;
  messages: UIMessage[];
};

const SCROLL_THRESHOLD = 120;

export const ChatTranscript = ({
  approvals,
  errorMessage,
  isStreaming,
  messages,
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
    <div className="relative max-h-[min(28rem,calc(100dvh-15rem))] min-h-0">
      <div
        className="max-h-[min(28rem,calc(100dvh-15rem))] overflow-y-auto overscroll-contain"
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
        <div
          className="flex w-full flex-col gap-4 px-4 pt-2 pb-3"
          ref={contentRef}
        >
          {messages.map((message) => (
            <ChatMessage
              approvals={approvals}
              isStreaming={isStreaming && message === messages.at(-1)}
              key={message.id}
              message={message}
            />
          ))}
          {errorMessage === undefined || errorMessage === "" ? null : (
            <div
              className="flex items-center gap-2 text-caption text-muted-fg"
              role="alert"
            >
              <span className="min-w-0 flex-1">{errorMessage}</span>
            </div>
          )}
        </div>
      </div>
      {showLatest ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <IconButtonTooltip label="Scroll to latest message">
            <Button
              aria-label="Scroll to latest message"
              className="pointer-events-auto rounded-full bg-bg-raised shadow-elevation"
              onClick={() => {
                scrollToLatest("smooth");
              }}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5"
                icon={ArrowDown01Icon}
              />
            </Button>
          </IconButtonTooltip>
        </div>
      ) : null}
    </div>
  );
};
