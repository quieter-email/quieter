"use client";

import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@quieter/ui/scroll-area";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatTurn, ResolveComposeTool } from "../types";
import { ChatError } from "./chat-error";
import { ConversationTurn } from "./conversation-turn";

type ChatTranscriptProps = {
  actionsDisabled?: boolean;
  errorMessage?: string;
  isStreaming: boolean;
  onCopy: (text: string) => void;
  onEditSubmit: (userMessageId: string, message: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  onResolveCompose: ResolveComposeTool;
  turns: ChatTurn[];
};

const SCROLL_THRESHOLD = 96;

const scrollTranscriptToBottom = (
  viewport: HTMLDivElement | null,
  behavior: ScrollBehavior,
  isNearBottomRef: { current: boolean },
  setShowScrollButton: (show: boolean) => void,
) => {
  if (!viewport) return;

  viewport.scrollTo({ behavior, top: viewport.scrollHeight });
  isNearBottomRef.current = true;
  setShowScrollButton(false);
};

export const ChatTranscript = ({
  actionsDisabled,
  errorMessage,
  isStreaming,
  onCopy,
  onEditSubmit,
  onRegenerate,
  onResolveCompose,
  turns,
}: ChatTranscriptProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const retryAssistantId = turns.at(-1)?.assistant?.id;

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        scrollTranscriptToBottom(viewportRef.current, "auto", isNearBottomRef, setShowScrollButton);
      }
    });

    resizeObserver.observe(content);
    return () => resizeObserver.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (isNearBottomRef.current) {
      scrollTranscriptToBottom(viewportRef.current, "auto", isNearBottomRef, setShowScrollButton);
    }
  }, [isStreaming, turns]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const { clientHeight, scrollHeight, scrollTop } = viewport;
    const nearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea className="h-full">
        <ScrollAreaViewport onScroll={handleScroll} ref={viewportRef}>
          <ScrollAreaContent>
            <div
              ref={contentRef}
              className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 pb-10 sm:px-6"
            >
              {turns.map((turn, index) => (
                <ConversationTurn
                  actionsDisabled={actionsDisabled}
                  isLastTurn={index === turns.length - 1}
                  isStreaming={isStreaming && index === turns.length - 1}
                  key={turn.id}
                  onCopy={onCopy}
                  onEditSubmit={onEditSubmit}
                  onRegenerate={onRegenerate}
                  onResolveCompose={onResolveCompose}
                  turn={turn}
                />
              ))}
              {errorMessage ? (
                <ChatError
                  disabled={actionsDisabled}
                  message={errorMessage}
                  onRetry={retryAssistantId ? () => onRegenerate(retryAssistantId) : undefined}
                />
              ) : null}
            </div>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>

      <AnimatePresence>
        {showScrollButton ? (
          <m.button
            animate={{ opacity: 1, y: 0 }}
            aria-label="Scroll to bottom"
            className={cn(
              "absolute bottom-4 left-1/2 -translate-x-1/2",
              "flex items-center gap-1.5 rounded-full border border-border/70 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm",
              "transition-colors hover:bg-muted/60 hover:text-foreground",
            )}
            exit={{ opacity: 0, y: 4 }}
            initial={{ opacity: 0, y: 4 }}
            onClick={() =>
              scrollTranscriptToBottom(
                viewportRef.current,
                "smooth",
                isNearBottomRef,
                setShowScrollButton,
              )
            }
            transition={{ duration: 0.15 }}
            type="button"
          >
            <HugeiconsIcon aria-hidden className="size-3" icon={ArrowDown01Icon} />
            New messages
          </m.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
