"use client";

import type { RefObject } from "react";
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@quieter/ui";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import type { ChatTurn } from "../types";
import { ChatError } from "./chat-error";
import { ConversationTurn } from "./conversation-turn";
import { ThinkingIndicator } from "./thinking-indicator";

type ChatTranscriptProps = {
  errorMessage?: string;
  isLoading: boolean;
  transcriptEndRef: RefObject<HTMLDivElement | null>;
  turns: ChatTurn[];
};

const SCROLL_THRESHOLD = 80;

export const ChatTranscript = ({
  errorMessage,
  isLoading,
  transcriptEndRef,
  turns,
}: ChatTranscriptProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = viewport;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [turns, isLoading, scrollToBottom]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ScrollAreaViewport ref={viewportRef}>
        <ScrollAreaContent>
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 pb-8 sm:px-6">
            <AnimatePresence initial={false}>
              {turns.map((turn, index) => (
                <ConversationTurn
                  isStreaming={isLoading && index === turns.length - 1}
                  key={turn.id}
                  turn={turn}
                />
              ))}
            </AnimatePresence>
            {isLoading &&
            !turns.at(-1)?.assistant?.parts.some((part) => part.type === "thinking") ? (
              <ThinkingIndicator />
            ) : null}
            {errorMessage && <ChatError message={errorMessage} />}
            <div ref={transcriptEndRef} />
          </div>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  );
};
