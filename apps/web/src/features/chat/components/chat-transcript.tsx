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
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { getAppPresenceMotion } from "#/features/motion/app-motion";

import type { ChatTurn, ResolveComposeTool } from "../types";
import { ChatError } from "./chat-error";
import {
  createChatTurnEntranceState,
  trackChatTurnEntrances,
} from "./chat-turn-entrance";
import { ConversationTurn } from "./conversation-turn";

type ChatTranscriptProps = {
  actionsDisabled?: boolean;
  errorMessage?: string;
  hydrated: boolean;
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
  setShowScrollButton: (show: boolean) => void
) => {
  if (!viewport) {
    return;
  }

  viewport.scrollTo({ behavior, top: viewport.scrollHeight });
  isNearBottomRef.current = true;
  setShowScrollButton(false);
};

export const ChatTranscript = ({
  actionsDisabled,
  errorMessage,
  hydrated,
  isStreaming,
  onCopy,
  onEditSubmit,
  onRegenerate,
  onResolveCompose,
  turns,
}: ChatTranscriptProps) => {
  const shouldReduceMotion = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  // react-doctor-disable-next-line react-doctor/rerender-lazy-ref-init -- Entrance tracking must remain one stable mutable session across renders.
  const turnEntranceStateRef = useRef(createChatTurnEntranceState());
  const [showScrollButton, setShowScrollButton] = useState(false);
  const retryAssistantId = turns.at(-1)?.assistant?.id;
  // react-doctor-disable-next-line react-hooks-js/refs -- The entrance tracker is intentionally mutable render-time bookkeeping.
  // react-doctor-disable-next-line react-hooks-js/refs -- The tracker is intentionally a stable mutable render-time session.
  const { enteringTurnIds, newTurnIds } = trackChatTurnEntrances(
    turnEntranceStateRef.current,
    turns.map((turn) => turn.id),
    hydrated
  );

  useEffect((): (() => void) | undefined => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        scrollTranscriptToBottom(
          viewportRef.current,
          "auto",
          isNearBottomRef,
          setShowScrollButton
        );
      }
    });

    resizeObserver.observe(content);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (isNearBottomRef.current) {
      scrollTranscriptToBottom(
        viewportRef.current,
        "auto",
        isNearBottomRef,
        setShowScrollButton
      );
    }
  }, [isStreaming, turns]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = viewport;
    const nearBottom =
      scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
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
              {turns.map((turn, index) => {
                const animateTurnEntrance = enteringTurnIds.has(turn.id);
                const turnMotion = getAppPresenceMotion({
                  reducedMotion: shouldReduceMotion,
                });
                const animateEntrance = newTurnIds.has(turn.id);

                return (
                  <m.div
                    key={turn.id}
                    {...turnMotion}
                    initial={animateTurnEntrance ? turnMotion.initial : false}
                  >
                    <ConversationTurn
                      actionsDisabled={actionsDisabled}
                      animateEntrance={animateEntrance}
                      isLastTurn={index === turns.length - 1}
                      isStreaming={isStreaming && index === turns.length - 1}
                      onCopy={onCopy}
                      onEditSubmit={onEditSubmit}
                      onRegenerate={onRegenerate}
                      onResolveCompose={onResolveCompose}
                      turn={turn}
                    />
                  </m.div>
                );
              })}
              <AnimatePresence initial={false}>
                {errorMessage !== null &&
                errorMessage !== undefined &&
                errorMessage !== "" ? (
                  <m.div
                    key="chat-error"
                    {...getAppPresenceMotion({
                      reducedMotion: shouldReduceMotion,
                    })}
                  >
                    <ChatError
                      disabled={actionsDisabled}
                      message={errorMessage}
                      onRetry={
                        retryAssistantId !== null &&
                        retryAssistantId !== undefined &&
                        retryAssistantId !== ""
                          ? () => {
                              onRegenerate(retryAssistantId);
                            }
                          : undefined
                      }
                    />
                  </m.div>
                ) : null}
              </AnimatePresence>
            </div>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <AnimatePresence initial={false}>
          {showScrollButton ? (
            <m.button
              {...getAppPresenceMotion({
                distance: 4,
                reducedMotion: shouldReduceMotion,
              })}
              aria-label="Scroll to bottom"
              className={cn(
                "pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-bg/95 px-3 py-1.5 text-xs text-muted-fg shadow-sm backdrop-blur-sm",
                "transition-colors hover:bg-muted/60 hover:text-fg"
              )}
              onClick={() => {
                scrollTranscriptToBottom(
                  viewportRef.current,
                  "smooth",
                  isNearBottomRef,
                  setShowScrollButton
                );
              }}
              type="button"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3"
                icon={ArrowDown01Icon}
              />
              New messages
            </m.button>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};
