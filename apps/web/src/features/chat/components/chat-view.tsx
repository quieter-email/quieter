"use client";

import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "@tanstack/ai";
import { Button } from "@quieter/ui";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup } from "motion/react";
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { chatQueryOptions, getChatQueryKey, getChatsQueryKey } from "~/lib/chat-query";
import { orpc } from "~/lib/orpc";
import type { ChatViewProps } from "../types";
import { createChatTurns } from "../domain/chat-turns";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

const isVisibleChatMessage = (message: UIMessage): message is UIMessage =>
  message.role === "user" || message.role === "assistant";

const getMessagesSnapshotKey = (messages: UIMessage[]) => JSON.stringify(messages);

type StoredChatMessage = RouterOutputs["chat"]["get"]["messages"][number];

const normalizeChatMessages = (messages: StoredChatMessage[]): UIMessage[] =>
  messages.map((message) => ({
    ...message,
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
    parts: message.parts as UIMessage["parts"],
  }));

export const ChatView = ({
  activeMailbox,
  chatId,
  draftChatKey,
  mailboxId,
  onChatIdChange,
  onOpenSidebar,
  onPendingPromptSent,
  pendingPrompt,
}: ChatViewProps) => {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const loadedChatIdRef = useRef<string | null>(null);
  const persistedSnapshotKeyRef = useRef("");
  const sentPendingPromptRef = useRef<string | null>(null);
  const activeChatKey = chatId ?? draftChatKey;
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const chatQuery = useQuery(chatQueryOptions(chatId));
  const createChatMutation = useMutation({
    ...orpc.chat.create.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getChatsQueryKey() });
    },
  });
  const saveMessagesMutation = useMutation({
    ...orpc.chat.saveMessages.mutationOptions(),
    onSuccess: async (_updatedChat, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getChatQueryKey(variables.chatId) }),
      ]);
      loadedChatIdRef.current = variables.chatId;
    },
  });
  const { error, isLoading, messages, sendMessage, setMessages, stop } = useChat({
    connection: fetchServerSentEvents("/api/chat"),
    forwardedProps: { category: activeMailbox, chatId, mailboxId },
    id: activeChatKey,
    threadId: chatId ?? activeChatKey,
  });
  const visibleMessages = useMemo(
    () => messages.filter((message): message is UIMessage => isVisibleChatMessage(message)),
    [messages],
  );
  const turns = useMemo(() => createChatTurns(visibleMessages), [visibleMessages]);
  const hasMessages = visibleMessages.length > 0;
  const isComposerLoading = isLoading || createChatMutation.isPending;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isLoading, visibleMessages]);

  useEffect(() => {
    if (!chatId || !pendingPrompt || sentPendingPromptRef.current === pendingPrompt) {
      return;
    }

    sentPendingPromptRef.current = pendingPrompt;
    void sendMessage(pendingPrompt).finally(onPendingPromptSent);
  }, [chatId, onPendingPromptSent, pendingPrompt, sendMessage]);

  useEffect(() => {
    if (
      !chatId ||
      !chatQuery.data ||
      loadedChatIdRef.current === chatId ||
      isLoading ||
      !!pendingPrompt ||
      visibleMessages.length > 0
    ) {
      return;
    }

    const storedMessages = normalizeChatMessages(chatQuery.data.messages);
    persistedSnapshotKeyRef.current = getMessagesSnapshotKey(storedMessages);
    setMessages(storedMessages);
    loadedChatIdRef.current = chatId;
  }, [chatId, chatQuery.data, isLoading, pendingPrompt, setMessages, visibleMessages.length]);

  useEffect(() => {
    if (!chatId || visibleMessages.length === 0) {
      return;
    }

    const snapshotKey = getMessagesSnapshotKey(visibleMessages);
    if (snapshotKey === persistedSnapshotKeyRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        persistedSnapshotKeyRef.current = snapshotKey;
        saveMessagesMutation.mutate({
          chatId,
          messages: visibleMessages,
        });
      },
      isLoading ? 300 : 0,
    );

    return () => window.clearTimeout(timeoutId);
  }, [chatId, isLoading, saveMessagesMutation, visibleMessages]);

  const submitPrompt = async () => {
    const prompt = input.trim();
    if (!prompt || isComposerLoading) return;

    if (!chatId) {
      const createdChat = await createChatMutation.mutateAsync(undefined);
      onChatIdChange(createdChat.id, prompt);
      setInput("");
      return;
    }

    void sendMessage(prompt);
    setInput("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    void submitPrompt();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border/60 bg-background-light lg:my-1 lg:mr-1 lg:rounded-lg">
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
                    isLoading={isComposerLoading}
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
                  isLoading={isComposerLoading}
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
