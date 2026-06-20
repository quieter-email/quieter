"use client";

import type { ChatMessagePart } from "@quieter/database";
import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "@tanstack/ai";
import { defaultChatModel, type ChatModel } from "@quieter/ai";
import { BILLING_FEATURES, hasBillingPlanAccess } from "@quieter/billing/plans";
import { Button, toast } from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGroup } from "motion/react";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import {
  formatBillingPlan,
  normalizeBillingPlan,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import { chatQueryOptions, getChatQueryKey, getChatsQueryKey } from "~/lib/chat-query";
import { orpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";
import type { ChatViewProps, ResolveComposeToolInput } from "../types";
import { createChatTurns } from "../domain/chat-turns";
import { useChatRunStream, type ChatRunStreamDone } from "../hooks/use-chat-run-stream";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

type ChatQueryData = RouterOutputs["chat"]["get"];
type ChatsQueryData = RouterOutputs["chat"]["list"];
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

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  } catch {
    toast.error("Could not copy to clipboard.");
  }
};

export const ChatView = ({
  activeMailbox,
  chatId,
  draftChatKey,
  mailboxId,
  onChatIdChange,
  onOpenSidebar,
}: ChatViewProps) => {
  const queryClient = useQueryClient();
  const { data: billing, isPending: isBillingPending } = useQuery(userBillingQueryOptions());
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ChatModel>(defaultChatModel);
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [streamingAssistant, setStreamingAssistant] = useState<{
    messageId: string;
    parts: ChatMessagePart[];
  } | null>(null);
  const { data: chatData } = useQuery({
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
  const generateTitleMutation = useMutation({
    ...orpc.chat.generateTitle.mutationOptions(),
    onSuccess: (updatedChat, variables) => {
      queryClient.setQueryData<ChatsQueryData>(getChatsQueryKey(variables.mailboxId), (current) =>
        current?.map((chat) =>
          chat.id === updatedChat.id ? { ...chat, title: updatedChat.title } : chat,
        ),
      );
      queryClient.setQueryData<ChatQueryData>(
        getChatQueryKey(variables.mailboxId, variables.chatId),
        (current) => (current ? { ...current, title: updatedChat.title } : current),
      );
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
  const resolveComposeToolMutation = useMutation(orpc.chat.resolveComposeTool.mutationOptions());

  const streamChatIdRef = useRef<string | null>(null);

  const beginAssistantStream = (result: ChatRunStartResult) => {
    streamChatIdRef.current = result.chatId;
    const queryKey = getChatQueryKey(mailboxId, result.chatId);

    queryClient.setQueryData<ChatQueryData>(queryKey, (current) =>
      current
        ? {
            ...current,
            activeRun: result.activeRun,
            messages: result.messages,
          }
        : current,
    );
    void queryPersister.persistQueryByKey(queryKey, queryClient);

    setStreamRunId(result.runId);
    setStreamingAssistant({
      messageId: result.assistantMessageId,
      parts: [{ content: "", type: "text" }],
    });
  };

  const activeRun = chatData?.activeRun ?? null;
  const liveRunId = streamRunId ?? (isActiveRun(activeRun) ? (activeRun?.id ?? null) : null);

  const commitStreamResult = (result: ChatRunStreamDone) => {
    const resolvedChatId = streamChatIdRef.current ?? chatId;

    if (!resolvedChatId || !result.assistantMessageId) {
      return;
    }

    const queryKey = getChatQueryKey(mailboxId, resolvedChatId);
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
    void queryPersister.persistQueryByKey(queryKey, queryClient);
  };

  useChatRunStream({
    enabled: !!liveRunId,
    onDone: (result) => {
      commitStreamResult(result);
      const resolvedChatId = streamChatIdRef.current ?? chatId;
      setStreamRunId(null);
      setStreamingAssistant(null);
      streamChatIdRef.current = null;

      if (resolvedChatId) {
        void queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
      }
    },
    onDraft: ({ assistantMessageId, parts }) => {
      setStreamingAssistant({ messageId: assistantMessageId, parts });
    },
    onError: (message) => {
      toast.error(message);
      const resolvedChatId = streamChatIdRef.current ?? chatId;

      if (resolvedChatId) {
        const queryKey = getChatQueryKey(mailboxId, resolvedChatId);
        queryClient.setQueryData<ChatQueryData>(queryKey, (current) =>
          current ? { ...current, activeRun: null } : current,
        );
        void queryPersister.persistQueryByKey(queryKey, queryClient);
        void queryClient.invalidateQueries({ queryKey });
      }

      setStreamRunId(null);
      setStreamingAssistant(null);
      streamChatIdRef.current = null;
    },
    runId: liveRunId,
  });

  const visibleMessages = (chatData ? normalizeChatMessages(chatData.messages) : []).map(
    (message) =>
      message.id === streamingAssistant?.messageId
        ? { ...message, parts: streamingAssistant.parts as UIMessage["parts"] }
        : message,
  );
  const turns = createChatTurns(visibleMessages);
  const isStreaming = !!liveRunId;
  const hasMessages = visibleMessages.length > 0 || !!chatId;
  const isComposerLoading =
    isStreaming ||
    createChatMutation.isPending ||
    sendMessageMutation.isPending ||
    cancelGenerationMutation.isPending ||
    editUserMessageMutation.isPending ||
    regenerateResponseMutation.isPending ||
    resolveComposeToolMutation.isPending;
  const currentPlan = normalizeBillingPlan(billing?.plan);
  const aiRequirement = BILLING_FEATURES.aiChat;
  const canUseAiChat =
    !!billing?.hasUnlimitedAccess || hasBillingPlanAccess(currentPlan, aiRequirement.requiredPlan);
  const composerDisabled = isBillingPending || !canUseAiChat;
  const errorMessage = activeRun?.error ?? chatData?.messages.at(-1)?.error ?? undefined;

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
        model,
      });

      generateTitleMutation.mutate({
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
    const activeChatId = streamChatIdRef.current ?? chatId;

    if (!activeChatId || !isStreaming) {
      return;
    }

    void cancelGenerationMutation.mutateAsync({ chatId: activeChatId, mailboxId });
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
        model,
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
        model,
      });

      beginAssistantStream(result);
      void queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Could not regenerate response.",
      );
    }
  };

  const handleResolveCompose = async (input: ResolveComposeToolInput) => {
    if (!chatId || isComposerLoading || composerDisabled) {
      return;
    }

    try {
      const result =
        input.action === "decline"
          ? await resolveComposeToolMutation.mutateAsync({
              action: input.action,
              assistantMessageId: input.assistantMessageId,
              category: activeMailbox,
              chatId,
              mailboxId,
              model,
              toolCallId: input.toolCallId,
            })
          : await resolveComposeToolMutation.mutateAsync({
              action: input.action,
              assistantMessageId: input.assistantMessageId,
              category: activeMailbox,
              chatId,
              mailboxId,
              message: input.message,
              model,
              toolCallId: input.toolCallId,
            });

      beginAssistantStream(result);
      void queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Could not complete the email.",
      );
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                actionsDisabled={isComposerLoading || composerDisabled}
                errorMessage={errorMessage}
                isStreaming={isStreaming}
                onCopy={(text) => void copyToClipboard(text)}
                onEditSubmit={(userMessageId, message) =>
                  void handleEditSubmit(userMessageId, message)
                }
                onRegenerate={(assistantMessageId) => void handleRegenerate(assistantMessageId)}
                onResolveCompose={handleResolveCompose}
                turns={turns}
              />

              <div className="w-full px-4 pb-5">
                <div className="mx-auto w-full max-w-2xl">
                  {!canUseAiChat && !isBillingPending && (
                    <PlanRequiredBlock
                      currentPlan={currentPlan}
                      requiredPlan={aiRequirement.requiredPlan}
                    />
                  )}
                  <ChatComposer
                    busy={isComposerLoading}
                    disabled={composerDisabled}
                    input={input}
                    model={model}
                    onInputChange={setInput}
                    onInputKeyDown={handleInputKeyDown}
                    onModelChange={setModel}
                    onStop={handleStop}
                    onSubmit={handleSubmit}
                    streaming={isStreaming}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4">
              <div className="w-full max-w-xl">
                {!canUseAiChat && !isBillingPending && (
                  <PlanRequiredBlock
                    currentPlan={currentPlan}
                    requiredPlan={aiRequirement.requiredPlan}
                  />
                )}
                <ChatComposer
                  busy={isComposerLoading}
                  disabled={composerDisabled}
                  input={input}
                  model={model}
                  onInputChange={setInput}
                  onInputKeyDown={handleInputKeyDown}
                  onModelChange={setModel}
                  onStop={handleStop}
                  onSubmit={handleSubmit}
                  streaming={isStreaming}
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
