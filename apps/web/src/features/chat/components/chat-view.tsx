"use client";

import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "@tanstack/ai";
import { BILLING_FEATURES, hasBillingPlanAccess } from "@quieter/billing/plans";
import { Button, toast } from "@quieter/ui";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGroup } from "motion/react";
import {
  type FormEvent,
  type KeyboardEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  formatBillingPlan,
  normalizeBillingPlan,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
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
  const billingQuery = useQuery(userBillingQueryOptions());
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
  const currentPlan = normalizeBillingPlan(billingQuery.data?.plan);
  const aiRequirement = BILLING_FEATURES.aiChat;
  const canUseAiChat =
    !!billingQuery.data?.hasUnlimitedAccess ||
    hasBillingPlanAccess(currentPlan, aiRequirement.requiredPlan);
  const composerDisabled = billingQuery.isPending || !canUseAiChat;

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
      mailboxId,
      messages: nextMessages,
    });
    persistedSnapshotKeyRef.current = snapshotKey;
  };

  const submitPrompt = async () => {
    const prompt = input.trim();
    if (!prompt || isComposerLoading || composerDisabled) return;

    try {
      let nextChatId = chatId;
      if (!nextChatId) {
        const createdChat = await createChatMutation.mutateAsync({ mailboxId });
        nextChatId = createdChat.id;
        onChatIdChange(createdChat.id);
      }

      await sendMessage(prompt);
      await waitForCommittedMessageState();
      await saveVisibleMessages(nextChatId);
      setInput("");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Could not send message.",
      );
    }
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
                  {!canUseAiChat && !billingQuery.isPending && (
                    <PlanRequiredBlock
                      currentPlan={currentPlan}
                      requiredPlan={aiRequirement.requiredPlan}
                    />
                  )}
                  <ChatComposer
                    disabled={composerDisabled}
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
                {!canUseAiChat && !billingQuery.isPending && (
                  <PlanRequiredBlock
                    currentPlan={currentPlan}
                    requiredPlan={aiRequirement.requiredPlan}
                  />
                )}
                <ChatComposer
                  disabled={composerDisabled}
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

const PlanRequiredBlock = ({
  currentPlan,
  requiredPlan,
}: {
  currentPlan: Parameters<typeof formatBillingPlan>[0];
  requiredPlan: "managed" | "pro";
}) => {
  const navigate = useNavigate();

  return (
    <div className="mb-3 rounded-lg border border-border/70 bg-secondary/35 p-3 text-sm">
      <p className="font-medium text-foreground">Upgrade required</p>
      <p className="mt-1 text-muted-foreground">
        AI chat requires {formatBillingPlan(requiredPlan)}. Your current plan is{" "}
        {formatBillingPlan(currentPlan)}.
      </p>
      <Button
        className="mt-3"
        onClick={() => {
          void navigate({ to: "/settings", search: { tab: "plan" } });
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        View plans
      </Button>
    </div>
  );
};
