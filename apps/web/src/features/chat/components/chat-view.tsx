"use client";

import type { UIMessage } from "@tanstack/ai";
import { Button } from "@quieter/ui";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { LayoutGroup } from "motion/react";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ChatViewProps } from "../types";
import { createChatTurns } from "../domain/chat-turns";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

export const ChatView = ({ activeMailbox, mailboxId, onOpenSidebar }: ChatViewProps) => {
  const [input, setInput] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const { error, isLoading, messages, sendMessage, stop } = useChat({
    body: { category: activeMailbox, mailboxId },
    connection: fetchServerSentEvents("/api/chat"),
  });
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message): message is UIMessage => message.role === "user" || message.role === "assistant",
      ),
    [messages],
  );
  const turns = useMemo(() => createChatTurns(visibleMessages), [visibleMessages]);
  const hasMessages = visibleMessages.length > 0;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isLoading, visibleMessages]);

  const submitPrompt = () => {
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    sendMessage(prompt);
    setInput("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPrompt();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    submitPrompt();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background-light lg:my-1 lg:mr-1 lg:rounded-lg">
      <header className="flex min-h-14 items-center px-3 lg:hidden">
        <Button onClick={onOpenSidebar} size="sm" type="button" variant="ghost">
          Sidebar
        </Button>
      </header>
      <LayoutGroup>
        <div className="flex min-h-0 flex-1 flex-col">
          {hasMessages ? (
            <>
              <ChatTranscript
                errorMessage={error?.message}
                isLoading={isLoading}
                transcriptEndRef={transcriptEndRef}
                turns={turns}
              />

              <div className="w-full px-4 pb-5">
                <div className="mx-auto w-full max-w-2xl">
                  <ChatComposer
                    input={input}
                    isLoading={isLoading}
                    onInputChange={setInput}
                    onInputKeyDown={handleInputKeyDown}
                    onStop={stop}
                    onSubmit={handleSubmit}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4">
              <div className="w-full max-w-xl">
                <ChatComposer
                  input={input}
                  isLoading={isLoading}
                  onInputChange={setInput}
                  onInputKeyDown={handleInputKeyDown}
                  onStop={stop}
                  onSubmit={handleSubmit}
                />
              </div>
            </div>
          )}
        </div>
      </LayoutGroup>
    </section>
  );
};
