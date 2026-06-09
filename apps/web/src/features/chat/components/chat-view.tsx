"use client";

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
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

type StoredChatMessage = RouterOutputs["chat"]["get"]["messages"][number];
type ActiveChatRun = RouterOutputs["chat"]["get"]["activeRun"];

const isActiveRun = (activeRun: ActiveChatRun | null | undefined) =>
  !!activeRun &&
  (activeRun.status === "queued" ||
    activeRun.status === "running" ||
    activeRun.status === "waiting_on_tool");

const getPollInterval = (activeRun: ActiveChatRun | null | undefined) => {
  if (!isActiveRun(activeRun)) {
    return false;
  }

  return 2_000;
};

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
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const chatQuery = useQuery({
    ...chatQueryOptions(mailboxId, chatId),
    refetchInterval: (query) => getPollInterval(query.state.data?.activeRun ?? null),
    refetchIntervalInBackground: true,
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

  const visibleMessages = useMemo(
    () => (chatQuery.data ? normalizeChatMessages(chatQuery.data.messages) : []),
    [chatQuery.data],
  );
  const turns = useMemo(() => createChatTurns(visibleMessages), [visibleMessages]);
  const activeRun = chatQuery.data?.activeRun ?? null;
  const isStreaming = isActiveRun(activeRun);
  const hasMessages = visibleMessages.length > 0 || !!chatId;
  const isComposerLoading =
    isStreaming ||
    createChatMutation.isPending ||
    sendMessageMutation.isPending ||
    cancelGenerationMutation.isPending;
  const currentPlan = normalizeBillingPlan(billingQuery.data?.plan);
  const aiRequirement = BILLING_FEATURES.aiChat;
  const canUseAiChat =
    !!billingQuery.data?.hasUnlimitedAccess ||
    hasBillingPlanAccess(currentPlan, aiRequirement.requiredPlan);
  const composerDisabled = billingQuery.isPending || !canUseAiChat;
  const errorMessage =
    activeRun?.error ??
    chatQuery.data?.messages.find((message) => message.error)?.error ??
    undefined;

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

      await sendMessageMutation.mutateAsync({
        category: activeMailbox,
        chatId: nextChatId,
        mailboxId,
        message: prompt,
      });
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
                errorMessage={errorMessage ?? undefined}
                isLoading={isStreaming}
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
