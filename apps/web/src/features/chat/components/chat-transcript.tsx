import type { RefObject } from "react";
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@quieter/ui";
import { AnimatePresence } from "motion/react";
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

export const ChatTranscript = ({
  errorMessage,
  isLoading,
  transcriptEndRef,
  turns,
}: ChatTranscriptProps) => (
  <ScrollArea className="min-h-0 flex-1">
    <ScrollAreaViewport>
      <ScrollAreaContent>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 pb-8 sm:px-6">
          <AnimatePresence initial={false}>
            {turns.map((turn) => (
              <ConversationTurn key={turn.id} turn={turn} />
            ))}
          </AnimatePresence>
          {isLoading && <ThinkingIndicator />}
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
