"use client";

import type { RefObject } from "react";
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@quieter/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ChatTurn } from "../types";
import { hasVisibleAssistantContent } from "../domain/assistant-content";
import { ChatError } from "./chat-error";
import { ConversationTurn } from "./conversation-turn";
import { ThinkingIndicator } from "./thinking-indicator";

type ChatTranscriptProps = {
  actionsDisabled?: boolean;
  errorMessage?: string;
  isStreaming: boolean;
  onCopy: (text: string) => void;
  onEditSubmit: (userMessageId: string, message: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  transcriptEndRef: RefObject<HTMLDivElement | null>;
  turns: ChatTurn[];
};

const SCROLL_THRESHOLD = 80;

const getTurnScrollSignature = (turns: ChatTurn[]) => {
  const lastTurn = turns.at(-1);

  if (!lastTurn) {
    return "";
  }

  const assistantSignature =
    lastTurn.assistant?.parts
      .map((part) => {
        if (part.type === "text" || part.type === "thinking") {
          return `${part.type}:${part.content}`;
        }

        if (part.type === "tool-call") {
          return `tool-call:${part.id}`;
        }

        if (part.type === "tool-result") {
          return `tool-result:${part.toolCallId}`;
        }

        return part.type;
      })
      .join("|") ?? "";

  return `${turns.length}:${lastTurn.id}:${assistantSignature}`;
};

export const ChatTranscript = ({
  actionsDisabled,
  errorMessage,
  isStreaming,
  onCopy,
  onEditSubmit,
  onRegenerate,
  transcriptEndRef,
  turns,
}: ChatTranscriptProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const scrollSignature = useMemo(() => getTurnScrollSignature(turns), [turns]);
  const lastTurn = turns.at(-1);
  const showThinkingIndicator =
    isStreaming && !!lastTurn?.assistant && !hasVisibleAssistantContent(lastTurn.assistant.parts);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ behavior, top: viewport.scrollHeight });
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
    if (!isNearBottomRef.current) {
      return;
    }

    scrollToBottom("auto");
  }, [scrollSignature, scrollToBottom]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ScrollAreaViewport ref={viewportRef}>
        <ScrollAreaContent>
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 pb-8 sm:px-6">
            {turns.map((turn, index) => (
              <ConversationTurn
                actionsDisabled={actionsDisabled}
                isLastTurn={index === turns.length - 1}
                isStreaming={isStreaming && index === turns.length - 1}
                key={turn.id}
                onCopy={onCopy}
                onEditSubmit={onEditSubmit}
                onRegenerate={onRegenerate}
                turn={turn}
              />
            ))}
            {showThinkingIndicator ? <ThinkingIndicator /> : null}
            {errorMessage ? <ChatError message={errorMessage} /> : null}
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
