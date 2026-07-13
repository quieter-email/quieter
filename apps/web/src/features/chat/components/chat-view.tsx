"use client";

import type { ChatModel } from "@quieter/ai/chat-models";
import type { ChatMessagePart } from "@quieter/database/schema";
import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "@tanstack/ai";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { Button } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";
import { type UseAudioRecorderReturn, useAudioRecorder } from "@tanstack/ai-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGroup } from "motion/react";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import {
  setDefaultChatModel,
  useDefaultChatModel,
} from "~/features/ai/domain/default-chat-model-setting";
import {
  hasOrganizationAiAccess,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "~/features/settings/domain/billing";
import {
  type BrowserAudioRecording,
  getTranscriptionAudioFormat,
  normalizeTranscriptionRecording,
} from "~/lib/audio-transcription";
import { chatQueryOptions, getChatQueryKey, getChatsQueryKey } from "~/lib/chat-query";
import { orpc } from "~/lib/orpc";
import { persistQueryByKey } from "~/lib/query-persister";
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

const MAX_TRANSCRIPTION_AUDIO_DURATION_MS = 60_000;
const MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH = 14_000_000;

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
  mailContext,
  mailboxId,
  mailboxOrganizationId,
  onChatIdChange,
  onOpenSidebar,
}: ChatViewProps) => {
  const queryClient = useQueryClient();
  const { data: billing, isPending: isBillingPending } = useQuery(userBillingQueryOptions());
  const [input, setInput] = useState("");
  const defaultModel = useDefaultChatModel();
  const [modelSelection, setModelSelection] = useState<{
    chatKey: string;
    model: ChatModel;
  } | null>(null);
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [streamingAssistant, setStreamingAssistant] = useState<{
    messageId: string;
    parts: ChatMessagePart[];
  } | null>(null);
  const [isPreparingTranscription, setIsPreparingTranscription] = useState(false);
  const { data: chatData } = useQuery({
    ...chatQueryOptions(mailboxId, chatId),
    refetchOnWindowFocus: true,
  });
  const chatKey = chatId ?? draftChatKey;
  const model =
    modelSelection?.chatKey === chatKey
      ? modelSelection.model
      : (chatData?.messages.length ?? 0) > 0 && chatData?.lastModel
        ? chatData.lastModel
        : defaultModel;
  const handleModelChange = (nextModel: ChatModel) => {
    setDefaultChatModel(nextModel);
    setModelSelection({ chatKey, model: nextModel });
  };
  const audioRecorder = useAudioRecorder({
    mimeType: "audio/webm;codecs=opus",
    onError: () => {
      toast.error("Could not access your microphone.");
    },
  }) as UseAudioRecorderReturn<BrowserAudioRecording>;
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
      const chatsQueryKey = getChatsQueryKey(variables.mailboxId);
      const chatQueryKey = getChatQueryKey(variables.mailboxId, variables.chatId);

      queryClient.setQueryData<ChatsQueryData>(chatsQueryKey, (current) =>
        current?.map((chat) =>
          chat.id === updatedChat.id ? { ...chat, title: updatedChat.title } : chat,
        ),
      );
      queryClient.setQueryData<ChatQueryData>(chatQueryKey, (current) =>
        current ? { ...current, title: updatedChat.title } : current,
      );
      void Promise.all([
        persistQueryByKey(chatsQueryKey, queryClient),
        persistQueryByKey(chatQueryKey, queryClient),
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
  const resolveComposeToolMutation = useMutation(orpc.chat.resolveComposeTool.mutationOptions());
  const transcribeAudioMutation = useMutation({
    ...orpc.chat.transcribeAudio.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });

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
    void persistQueryByKey(queryKey, queryClient);

    setStreamRunId(result.runId);
    setStreamingAssistant({
      messageId: result.assistantMessageId,
      parts: [{ content: "", type: "text" }],
    });
  };

  const activeRun = chatData?.activeRun ?? null;
  const liveRunId = streamRunId ?? (isActiveRun(activeRun) ? (activeRun?.id ?? null) : null);

  const commitStreamResult = (result: ChatRunStreamDone, resolvedChatId?: string | null) => {
    let targetChatId = resolvedChatId;
    if (!targetChatId) targetChatId = streamChatIdRef.current;
    if (!targetChatId) targetChatId = chatId;

    if (!targetChatId || !result.assistantMessageId) {
      return;
    }

    const queryKey = getChatQueryKey(mailboxId, targetChatId);
    const messageStatus =
      result.status === "failed"
        ? "failed"
        : result.status === "cancelled"
          ? "cancelled"
          : "complete";

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
    void persistQueryByKey(queryKey, queryClient);
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
        void persistQueryByKey(queryKey, queryClient);
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
  const isTranscribingAudio = isPreparingTranscription || transcribeAudioMutation.isPending;
  const isActionPending =
    createChatMutation.isPending ||
    sendMessageMutation.isPending ||
    cancelGenerationMutation.isPending ||
    editUserMessageMutation.isPending ||
    regenerateResponseMutation.isPending ||
    resolveComposeToolMutation.isPending;
  const aiRequirement = BILLING_FEATURES.aiChat;
  const canUseAiChat = hasOrganizationAiAccess(billing, mailboxOrganizationId);
  const composerDisabled = isBillingPending || !canUseAiChat;
  const errorMessage = activeRun?.error ?? chatData?.messages.at(-1)?.error ?? undefined;

  const submitPrompt = async () => {
    const prompt = input.trim();
    if (
      !prompt ||
      isStreaming ||
      isActionPending ||
      isTranscribingAudio ||
      composerDisabled ||
      audioRecorder.isRecording
    ) {
      return;
    }

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
        context: mailContext,
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
    if (isStreaming || isActionPending || isTranscribingAudio) return;
    void submitPrompt();
  };

  const handleStop = () => {
    const activeChatId = streamChatIdRef.current ?? chatId;

    if (!activeChatId || !isStreaming) {
      return;
    }

    const queryKey = getChatQueryKey(mailboxId, activeChatId);
    const assistantMessageId = streamingAssistant?.messageId ?? activeRun?.assistantMessageId;
    const assistantParts = streamingAssistant?.parts;

    queryClient.setQueryData<ChatQueryData>(queryKey, (current) =>
      current
        ? {
            ...current,
            activeRun: null,
            messages: current.messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    error: null,
                    parts: assistantParts ?? message.parts,
                    status: "cancelled" as const,
                  }
                : message,
            ),
          }
        : current,
    );
    void persistQueryByKey(queryKey, queryClient);
    setStreamRunId(null);
    setStreamingAssistant(null);
    streamChatIdRef.current = null;

    void cancelGenerationMutation
      .mutateAsync({ chatId: activeChatId, mailboxId })
      .then((result) => {
        if (result.cancelled) {
          commitStreamResult(
            {
              assistantMessageId: result.assistantMessageId,
              error: result.error,
              parts: result.parts,
              status: result.status,
            },
            activeChatId,
          );
        }
        void queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) });
      })
      .catch(() => {
        toast.error("The response could not be stopped. Its status is being refreshed.");
        void queryClient.invalidateQueries({ queryKey });
      });
  };

  const handleRecordingStart = () => {
    if (composerDisabled || isTranscribingAudio) return;

    if (!audioRecorder.isSupported) {
      toast.error("Audio recording is not supported in this browser.");
      return;
    }

    void audioRecorder.start().catch(() => {
      toast.error("Could not start recording.");
    });
  };

  const handleRecordingStop = () => {
    setIsPreparingTranscription(true);
    void audioRecorder
      .stop()
      .then(async (nativeRecording) => {
        if (nativeRecording.durationMs > MAX_TRANSCRIPTION_AUDIO_DURATION_MS) {
          toast.error("Recordings must be 60 seconds or shorter.");
          return null;
        }

        const recording = await normalizeTranscriptionRecording(nativeRecording);
        const format = getTranscriptionAudioFormat(recording.mimeType);

        if (!format) {
          toast.error("This recording could not be prepared for transcription.");
          return null;
        }

        if (recording.base64.length > MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH) {
          toast.error("This recording is too large to transcribe.");
          return null;
        }

        return await transcribeAudioMutation.mutateAsync({
          audioBase64: recording.base64,
          chatId: chatId ?? undefined,
          durationMs: recording.durationMs,
          format,
          mailboxId,
        });
      })
      .then((result) => {
        if (!result) return;
        setInput((current) =>
          current.trim() ? `${current.trimEnd()}\n${result.text}` : result.text,
        );
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error &&
            (error.message.startsWith("Transcription ") ||
              error.message.startsWith("We could not transcribe ") ||
              error.message === "No speech was detected.")
            ? error.message
            : "We could not transcribe that recording. Try recording it again.",
        );
      })
      .finally(() => {
        setIsPreparingTranscription(false);
      });
  };

  const handleEditSubmit = async (userMessageId: string, message: string) => {
    if (!chatId || isStreaming || isActionPending || composerDisabled) {
      return;
    }

    try {
      const result = await editUserMessageMutation.mutateAsync({
        category: activeMailbox,
        chatId,
        context: mailContext,
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
    if (!chatId || isStreaming || isActionPending || composerDisabled) {
      return;
    }

    try {
      const result = await regenerateResponseMutation.mutateAsync({
        assistantMessageId,
        category: activeMailbox,
        chatId,
        context: mailContext,
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
    if (!chatId || isStreaming || isActionPending || composerDisabled) {
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
              context: mailContext,
              mailboxId,
              model,
              toolCallId: input.toolCallId,
            })
          : await resolveComposeToolMutation.mutateAsync({
              action: input.action,
              assistantMessageId: input.assistantMessageId,
              category: activeMailbox,
              chatId,
              context: mailContext,
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
                actionsDisabled={isStreaming || isActionPending || composerDisabled}
                errorMessage={errorMessage}
                isStreaming={isStreaming}
                onCopy={(text) => void copyToClipboard(text)}
                onEditSubmit={handleEditSubmit}
                onRegenerate={handleRegenerate}
                onResolveCompose={handleResolveCompose}
                turns={turns}
              />

              <div className="w-full px-4 pb-5">
                <div className="mx-auto w-full max-w-2xl">
                  {!canUseAiChat && !isBillingPending && (
                    <PlanRequiredBlock
                      organizationId={mailboxOrganizationId}
                      requirementLabel={aiRequirement.requirementLabel}
                    />
                  )}
                  <ChatComposer
                    disabled={composerDisabled}
                    input={input}
                    model={model}
                    onInputChange={setInput}
                    onInputKeyDown={handleInputKeyDown}
                    onModelChange={handleModelChange}
                    onRecordingStart={handleRecordingStart}
                    onRecordingStop={handleRecordingStop}
                    onStop={handleStop}
                    onSubmit={handleSubmit}
                    recording={audioRecorder.isRecording}
                    recordingSupported={audioRecorder.isSupported}
                    streaming={isStreaming}
                    submitting={isActionPending}
                    transcribing={isTranscribingAudio}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4">
              <div className="w-full max-w-xl">
                {!canUseAiChat && !isBillingPending && (
                  <PlanRequiredBlock
                    organizationId={mailboxOrganizationId}
                    requirementLabel={aiRequirement.requirementLabel}
                  />
                )}
                <ChatComposer
                  disabled={composerDisabled}
                  input={input}
                  model={model}
                  onInputChange={setInput}
                  onInputKeyDown={handleInputKeyDown}
                  onModelChange={handleModelChange}
                  onRecordingStart={handleRecordingStart}
                  onRecordingStop={handleRecordingStop}
                  onStop={handleStop}
                  onSubmit={handleSubmit}
                  recording={audioRecorder.isRecording}
                  recordingSupported={audioRecorder.isSupported}
                  streaming={isStreaming}
                  submitting={isActionPending}
                  transcribing={isTranscribingAudio}
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
  organizationId,
  requirementLabel,
}: {
  organizationId: string;
  requirementLabel: string;
}) => {
  const navigate = useNavigate();

  return (
    <div className="mb-3 rounded-lg border border-border/70 bg-secondary/35 p-3 text-sm">
      <p className="font-medium text-foreground">Upgrade required</p>
      <p className="mt-1 text-muted-foreground">
        AI chat requires {requirementLabel} billing with available credits.
      </p>
      <Button
        className="mt-3"
        onClick={() => {
          void navigate({
            to: "/settings",
            search: {
              organizationId,
              organizationView: "overview",
              tab: "organization",
            },
          });
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
