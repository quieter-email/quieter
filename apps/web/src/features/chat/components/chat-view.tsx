"use client";

import type { ChatMessagePart } from "@quieter/database";
import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "@tanstack/ai";
import { BILLING_FEATURES, hasBillingPlanAccess } from "@quieter/billing/plans";
import { Button, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGroup } from "motion/react";
import { type FormEvent, type KeyboardEvent, useMemo, useRef, useState } from "react";
import {
  formatBillingPlan,
  normalizeBillingPlan,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { chatQueryOptions, getChatQueryKey, getChatsQueryKey } from "~/lib/chat-query";
import { orpc } from "~/lib/orpc";
import type { ChatViewProps } from "../types";
import { createChatTurns } from "../domain/chat-turns";
import { useChatRunStream, type ChatRunStreamDone } from "../hooks/use-chat-run-stream";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

type ChatQueryData = RouterOutputs["chat"]["get"];
type StoredChatMessage = ChatQueryData["messages"][number];
type ActiveChatRun = ChatQueryData["activeRun"];
type ChatRunStartResult = RouterOutputs["chat"]["sendMessage"];

const isActiveRun = (activeRun: ActiveChatRun | null | undefined) =>
  !!activeRun &&
  (activeRun.status === "queued" ||
    activeRun.status === "running" ||
    activeRun.status === "waiting_on_tool");

const normalizeChatMessages = (messages: StoredChatMessage[]): UIMessage[] =>
  messages.map((message) => ({
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
    id: message.id,
    parts: message.parts as UIMessage["parts"],
    role: message.role,
  }));

export const ChatView = ({
  activeMailbox,
  chatId,
  draftChatKey,
  mailboxId,
  onChatIdChange,
  onOpenSidebar,
}: ChatViewProps) => {
  const queryClient = useQueryClient();
  const billingQuery = useQuery(userBillingQueryOptions());
  const [input, setInput] = useState("");
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [streamingAssistant, setStreamingAssistant] = useState<{
    messageId: string;
    parts: ChatMessagePart[];
  } | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const chatQuery = useQuery({
    ...chatQueryOptions(mailboxId, chatId),
    refetchOnWindowFocus: true,
  });
  const createChatMutation = useMutation({
    ...orpc.chat.create.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
    },
  });
  const sendMessageMutation = useMutation({
    ...orpc.chat.sendMessage.mutationOptions(),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) }),
        queryClient.invalidateQueries({
          queryKey: getChatQueryKey(mailboxId, variables.chatId),
        }),
      ]);
    },
  });
  const cancelGenerationMutation = useMutation({
    ...orpc.chat.cancelGeneration.mutationOptions(),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getChatQueryKey(mailboxId, variables.chatId),
      });
    },
  });
  const editUserMessageMutation = useMutation(orpc.chat.editUserMessage.mutationOptions());
  const regenerateResponseMutation = useMutation(orpc.chat.regenerateResponse.mutationOptions());

  const beginAssistantStream = (result: ChatRunStartResult) => {
    if (!chatId) {
      return;
    }

    queryClient.setQueryData<ChatQueryData>(getChatQueryKey(mailboxId, chatId), (current) =>
      current
        ? {
            ...current,
            activeRun: result.activeRun,
            messages: result.messages,
          }
        : current,
    );

    setStreamRunId(result.runId);
    setStreamingAssistant({
      messageId: result.assistantMessageId,
      parts: [{ content: "", type: "text" }],
    });
  };

  const activeRun = chatQuery.data?.activeRun ?? null;
  const liveRunId = streamRunId ?? (isActiveRun(activeRun) ? (activeRun?.id ?? null) : null);

  const commitStreamResult = (result: ChatRunStreamDone) => {
    if (!chatId || !result.assistantMessageId) {
      return;
    }

    const queryKey = getChatQueryKey(mailboxId, chatId);
    const messageStatus =
      result.status === "failed" || result.status === "cancelled" ? "failed" : "complete";

    queryClient.setQueryData<ChatQueryData>(queryKey, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        activeRun: null,
        messages: current.messages.map((message: StoredChatMessage) =>
          message.id === result.assistantMessageId
            ? {
                ...message,
                error: result.error ?? null,
                parts: result.parts,
                status: messageStatus,
              }
            : message,
        ),
      };
    });
  };

  useChatRunStream({
    enabled: !!liveRunId,
    onDone: (result) => {
      commitStreamResult(result);
      setStreamRunId(null);
      setStreamingAssistant(null);

      if (chatId) {
        void queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
      }
    },
    onDraft: ({ assistantMessageId, parts }) => {
      setStreamingAssistant({ messageId: assistantMessageId, parts });
    },
    onError: (message) => {
      toast.error(message);
    },
    runId: liveRunId,
  });

  const visibleMessages = useMemo(() => {
    const messages = chatQuery.data ? normalizeChatMessages(chatQuery.data.messages) : [];

    if (!streamingAssistant) {
      return messages;
    }

    return messages.map((message) =>
      message.id === streamingAssistant.messageId
        ? { ...message, parts: streamingAssistant.parts as UIMessage["parts"] }
        : message,
    );
  }, [chatQuery.data, streamingAssistant]);

  const turns = useMemo(() => createChatTurns(visibleMessages), [visibleMessages]);
  const isStreaming = !!liveRunId;
  const hasMessages = visibleMessages.length > 0 || !!chatId;
  const isComposerLoading =
    isStreaming ||
    createChatMutation.isPending ||
    sendMessageMutation.isPending ||
    cancelGenerationMutation.isPending ||
    editUserMessageMutation.isPending ||
    regenerateResponseMutation.isPending;
  const currentPlan = normalizeBillingPlan(billingQuery.data?.plan);
  const aiRequirement = BILLING_FEATURES.aiChat;
  const canUseAiChat =
    !!billingQuery.data?.hasUnlimitedAccess ||
    hasBillingPlanAccess(currentPlan, aiRequirement.requiredPlan);
  const composerDisabled = billingQuery.isPending || !canUseAiChat;
  const errorMessage = activeRun?.error ?? chatQuery.data?.messages.at(-1)?.error ?? undefined;

  const submitPrompt = async () => {
    const prompt = input.trim();
    if (!prompt || isComposerLoading || composerDisabled) return;

    try {
      let nextChatId = chatId;
      if (!nextChatId) {
        const createdChat = await createChatMutation.mutateAsync({ mailboxId });
        nextChatId = createdChat.id;
        onChatIdChange(nextChatId);
      }

      const result = await sendMessageMutation.mutateAsync({
        category: activeMailbox,
        chatId: nextChatId,
        mailboxId,
        message: prompt,
      });

      beginAssistantStream(result);
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

  const handleStop = () => {
    if (!chatId || !isStreaming) {
      return;
    }

    void cancelGenerationMutation.mutateAsync({ chatId, mailboxId });
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  const handleEditSubmit = async (userMessageId: string, message: string) => {
    if (!chatId || isComposerLoading || composerDisabled) {
      return;
    }

    try {
      const result = await editUserMessageMutation.mutateAsync({
        category: activeMailbox,
        chatId,
        mailboxId,
        message,
        userMessageId,
      });

      beginAssistantStream(result);
      void queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Could not edit message.",
      );
    }
  };

  const handleRegenerate = async (assistantMessageId: string) => {
    if (!chatId || isComposerLoading || composerDisabled) {
      return;
    }

    try {
      const result = await regenerateResponseMutation.mutateAsync({
        assistantMessageId,
        category: activeMailbox,
        chatId,
        mailboxId,
      });

      beginAssistantStream(result);
      void queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Could not regenerate response.",
      );
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-l">
      <header className="flex min-h-14 items-center px-3 lg:hidden">
        <Button onClick={onOpenSidebar} size="sm" type="button" variant="ghost">
          Sidebar
        </Button>
      </header>
      <LayoutGroup id={chatId ?? draftChatKey}>
        <div className="flex min-h-0 flex-1 flex-col">
          {hasMessages ? (
            <>
              <ChatTranscript
                actionsDisabled={composerDisabled}
                errorMessage={errorMessage}
                isStreaming={isStreaming}
                onCopy={(text) => void handleCopy(text)}
                onEditSubmit={(userMessageId, message) =>
                  void handleEditSubmit(userMessageId, message)
                }
                onRegenerate={(assistantMessageId) => void handleRegenerate(assistantMessageId)}
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
                    onStop={handleStop}
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
                  onStop={handleStop}
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
