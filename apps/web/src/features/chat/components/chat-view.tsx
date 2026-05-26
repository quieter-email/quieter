"use client";

import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "@tanstack/ai";
import { Button } from "@quieter/ui";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const waitForCommittedMessageState = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

export const ChatView = ({
  activeMailbox,
  chatId,
  draftChatKey,
  mailboxId,
  onChatIdChange,
  onOpenSidebar,
}: ChatViewProps) => {
  const chatQuery = useQuery(chatQueryOptions(mailboxId, chatId));
  const initialMessages = useMemo(
    () => (chatQuery.data ? normalizeChatMessages(chatQuery.data.messages) : []),
    [chatQuery.data],
  );
  const initialSnapshotKey = useMemo(
    () => getMessagesSnapshotKey(initialMessages),
    [initialMessages],
  );
  const sessionKey = chatId
    ? `chat-${chatId}-${chatQuery.data ? "loaded" : "loading"}`
    : draftChatKey;

  return (
    <ChatSession
      key={sessionKey}
      activeMailbox={activeMailbox}
      chatId={chatId}
      draftChatKey={draftChatKey}
      initialMessages={initialMessages}
      initialSnapshotKey={initialSnapshotKey}
      mailboxId={mailboxId}
      onChatIdChange={onChatIdChange}
      onOpenSidebar={onOpenSidebar}
    />
  );
};

type ChatSessionProps = ChatViewProps & {
  initialMessages: UIMessage[];
  initialSnapshotKey: string;
};

const ChatSession = ({
  activeMailbox,
  chatId,
  draftChatKey,
  initialMessages,
  initialSnapshotKey,
  mailboxId,
  onChatIdChange,
  onOpenSidebar,
}: ChatSessionProps) => {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const persistedSnapshotKeyRef = useRef(initialSnapshotKey);
  const activeChatKey = chatId ?? draftChatKey;
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const visibleMessagesRef = useRef<UIMessage[]>([]);
  const createChatMutation = useMutation({
    ...orpc.chat.create.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
    },
  });
  const saveMessagesMutation = useMutation({
    ...orpc.chat.saveMessages.mutationOptions(),
    onSuccess: async (_updatedChat, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) }),
        queryClient.invalidateQueries({
          queryKey: getChatQueryKey(mailboxId, variables.chatId),
        }),
      ]);
    },
  });
  const { error, isLoading, messages, sendMessage, stop } = useChat({
    connection: fetchServerSentEvents("/api/chat"),
    forwardedProps: { category: activeMailbox, chatId, mailboxId },
    id: activeChatKey,
    initialMessages,
    threadId: chatId ?? activeChatKey,
  });
  const visibleMessages = useMemo(
    () => messages.filter((message): message is UIMessage => isVisibleChatMessage(message)),
    [messages],
  );
  useLayoutEffect(() => {
    visibleMessagesRef.current = visibleMessages;
  }, [visibleMessages]);
  const turns = useMemo(() => createChatTurns(visibleMessages), [visibleMessages]);
  const hasMessages = visibleMessages.length > 0 || !!chatId;
  const isComposerLoading =
    isLoading || createChatMutation.isPending || saveMessagesMutation.isPending;

  const saveVisibleMessages = async (nextChatId: string) => {
    const nextMessages = visibleMessagesRef.current;
    if (nextMessages.length === 0) {
      return;
    }

    const snapshotKey = getMessagesSnapshotKey(nextMessages);
    if (snapshotKey === persistedSnapshotKeyRef.current) {
      return;
    }

    await saveMessagesMutation.mutateAsync({
      chatId: nextChatId,
      messages: nextMessages,
    });
    persistedSnapshotKeyRef.current = snapshotKey;
  };

  const submitPrompt = async () => {
    const prompt = input.trim();
    if (!prompt || isComposerLoading) return;

    setInput("");

    if (!chatId) {
      const [createdChat] = await Promise.all([
        createChatMutation.mutateAsync(undefined),
        sendMessage(prompt),
      ]);
      await waitForCommittedMessageState().then(() => saveVisibleMessages(createdChat.id));
      onChatIdChange(createdChat.id);
      return;
    }

    await sendMessage(prompt)
      .then(waitForCommittedMessageState)
      .then(() => saveVisibleMessages(chatId));
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border/60 bg-background-light/75 lg:my-1 lg:mr-1 lg:rounded-lg">
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
