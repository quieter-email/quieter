"use client";

import type { ChatModel } from "@quieter/ai/chat-models";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import type { ChatMessagePart } from "@quieter/database/schema";
import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";
import type { UIMessage } from "@tanstack/ai";
import { useAudioRecorder } from "@tanstack/ai-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  domMax,
  LayoutGroup,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent, SubmitEvent } from "react";

import { MobileHeader } from "#/components/mobile-header";
import {
  setDefaultChatModel,
  useDefaultChatModel,
} from "#/features/ai/domain/default-chat-model-setting";
import { appEaseInOut, appMotionDuration } from "#/features/motion/app-motion";
import {
  hasOrganizationAiAccess,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "#/features/settings/domain/billing";
import {
  getTranscriptionAudioFormat,
  normalizeTranscriptionRecording,
} from "#/lib/audio-transcription";
import type { BrowserAudioRecording } from "#/lib/audio-transcription";
import {
  chatQueryOptions,
  getChatQueryKey,
  getChatsQueryKey,
} from "#/lib/chat-query";
import { orpc } from "#/lib/orpc";
import { persistQueryByKey } from "#/lib/query-persister";

import { createChatTurns } from "../domain/chat-turns";
import { useChatRunStream } from "../hooks/use-chat-run-stream";
import type { ChatRunStreamDone } from "../hooks/use-chat-run-stream";
import type { ChatViewProps, ResolveComposeToolInput } from "../types";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

type ChatQueryData = RouterOutputs["chat"]["get"];
type ChatsQueryData = RouterOutputs["chat"]["list"];
type StoredChatMessage = ChatQueryData["messages"][number];
type ActiveChatRun = ChatQueryData["activeRun"];
type ChatRunStartResult = RouterOutputs["chat"]["sendMessage"];

const MAX_TRANSCRIPTION_AUDIO_DURATION_MS = 60_000;
const MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH = 14_000_000;

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

const isUiMessagePartArray = (value: unknown): value is UIMessage["parts"] =>
  Array.isArray(value);

const isActiveRun = (activeRun: ActiveChatRun | null | undefined) =>
  !!activeRun &&
  (activeRun.status === "queued" ||
    activeRun.status === "running" ||
    activeRun.status === "waiting_on_tool");

const normalizeChatMessages = (messages: StoredChatMessage[]): UIMessage[] =>
  messages.map((message) => ({
    createdAt:
      message.createdAt === null || message.createdAt === undefined
        ? undefined
        : new Date(message.createdAt),
    id: message.id,
    parts: isUiMessagePartArray(message.parts) ? message.parts : [],
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

const PlanRequiredBlock = ({
  organizationId,
  requirementLabel,
}: {
  organizationId: string;
  requirementLabel: string;
}) => {
  const navigate = useNavigate();

  return (
    <div className="mb-3 rounded-lg border border-border bg-secondary/35 p-3 text-sm">
      <p className="font-medium text-fg">Upgrade required</p>
      <p className="mt-1 text-muted-fg">
        AI chat requires {requirementLabel} billing with available credits.
      </p>
      <Button
        className="mt-3"
        onClick={() => {
          void navigate({
            search: {
              organizationId,
              organizationView: "overview",
              tab: "organization",
            },
            to: "/settings",
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

type ChatComposerProps = ComponentProps<typeof ChatComposer>;
type ChatTranscriptProps = ComponentProps<typeof ChatTranscript>;

const ChatComposerPanel = ({
  canUseAiChat,
  isBillingPending,
  mailboxOrganizationId,
  requirementLabel,
  ...composerProps
}: ChatComposerProps & {
  canUseAiChat: boolean;
  isBillingPending: boolean;
  mailboxOrganizationId: string;
  requirementLabel: string;
}) => (
  <>
    {!canUseAiChat && !isBillingPending ? (
      <PlanRequiredBlock
        organizationId={mailboxOrganizationId}
        requirementLabel={requirementLabel}
      />
    ) : null}
    <ChatComposer {...composerProps} />
  </>
);

const chatExamplePrompts = [
  "Summarize what's unread",
  "Draft a reply to the latest message",
];

const ChatViewLayout = ({
  chatId,
  chatTitle,
  composer,
  draftChatKey,
  hasMessages,
  onOpenSidebar,
  shouldReduceMotion,
  transcript,
}: {
  chatId: string | null;
  chatTitle: string | null | undefined;
  composer: ChatComposerProps & {
    canUseAiChat: boolean;
    isBillingPending: boolean;
    mailboxOrganizationId: string;
    requirementLabel: string;
  };
  draftChatKey: string;
  hasMessages: boolean;
  onOpenSidebar: () => void;
  shouldReduceMotion: boolean | null;
  transcript: ChatTranscriptProps;
}) => (
  <LazyMotion features={domMax}>
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MobileHeader
        leading="sidebar"
        onLeadingClick={onOpenSidebar}
        title={hasMessages && hasText(chatTitle) ? chatTitle : undefined}
      />
      {hasMessages && hasText(chatTitle) ? (
        <header className="hidden shrink-0 items-center border-b border-border px-4 py-3 lg:flex">
          <h1 className="truncate text-sm font-medium tracking-tight text-fg">
            {chatTitle}
          </h1>
        </header>
      ) : null}
      <LayoutGroup id={chatId ?? draftChatKey}>
        <div className="flex min-h-0 flex-1 flex-col">
          {hasMessages ? (
            <>
              <ChatTranscript {...transcript} />
              <div className="w-full px-4 pb-5">
                <m.div
                  className="mx-auto w-full max-w-2xl"
                  layoutDependency={hasMessages}
                  layoutId="chat-composer"
                  transition={{
                    duration:
                      shouldReduceMotion === true
                        ? 0
                        : appMotionDuration.layout,
                    ease: appEaseInOut,
                  }}
                >
                  <ChatComposerPanel {...composer} />
                </m.div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4">
              <p className="text-title-sm tracking-tight text-fg">
                Ask about your mail
              </p>
              <m.div
                className="w-full max-w-xl"
                layoutDependency={hasMessages}
                layoutId="chat-composer"
                transition={{
                  duration:
                    shouldReduceMotion === true ? 0 : appMotionDuration.layout,
                  ease: appEaseInOut,
                }}
              >
                <ChatComposerPanel {...composer} />
              </m.div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {chatExamplePrompts.map((prompt) => (
                  <Button
                    key={prompt}
                    onClick={() => {
                      composer.onInputChange(prompt);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </LayoutGroup>
    </section>
  </LazyMotion>
);

type ChatViewMutationSet = {
  cancelGenerationMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["cancelGeneration"],
      unknown,
      RouterInputs["chat"]["cancelGeneration"]
    >,
    "isPending" | "mutateAsync"
  >;
  createChatMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["create"],
      unknown,
      RouterInputs["chat"]["create"]
    >,
    "isPending" | "mutateAsync"
  >;
  editUserMessageMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["editUserMessage"],
      unknown,
      RouterInputs["chat"]["editUserMessage"]
    >,
    "isPending" | "mutateAsync"
  >;
  generateTitleMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["generateTitle"],
      unknown,
      RouterInputs["chat"]["generateTitle"]
    >,
    "mutate"
  >;
  regenerateResponseMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["regenerateResponse"],
      unknown,
      RouterInputs["chat"]["regenerateResponse"]
    >,
    "isPending" | "mutateAsync"
  >;
  resolveComposeToolMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["resolveComposeTool"],
      unknown,
      RouterInputs["chat"]["resolveComposeTool"]
    >,
    "isPending" | "mutateAsync"
  >;
  sendMessageMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["sendMessage"],
      unknown,
      RouterInputs["chat"]["sendMessage"]
    >,
    "isPending" | "mutateAsync"
  >;
  transcribeAudioMutation: Pick<
    UseMutationResult<
      RouterOutputs["chat"]["transcribeAudio"],
      unknown,
      RouterInputs["chat"]["transcribeAudio"]
    >,
    "isPending" | "mutateAsync"
  >;
};

const useChatViewMutations = ({
  mailboxId,
  queryClient,
}: {
  mailboxId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}): ChatViewMutationSet => {
  const createChatMutation = useMutation({
    ...orpc.chat.create.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(mailboxId),
      });
    },
  });
  const sendMessageMutation = useMutation({
    ...orpc.chat.sendMessage.mutationOptions(),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getChatsQueryKey(mailboxId),
        }),
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
      const chatQueryKey = getChatQueryKey(
        variables.mailboxId,
        variables.chatId
      );

      queryClient.setQueryData<ChatsQueryData>(chatsQueryKey, (current) =>
        current?.map((chat) =>
          chat.id === updatedChat.id
            ? { ...chat, title: updatedChat.title }
            : chat
        )
      );
      queryClient.setQueryData<ChatQueryData>(chatQueryKey, (current) =>
        current ? { ...current, title: updatedChat.title } : current
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
  const editUserMessageMutation = useMutation(
    orpc.chat.editUserMessage.mutationOptions()
  );
  const regenerateResponseMutation = useMutation(
    orpc.chat.regenerateResponse.mutationOptions()
  );
  const resolveComposeToolMutation = useMutation(
    orpc.chat.resolveComposeTool.mutationOptions()
  );
  const transcribeAudioMutation = useMutation({
    ...orpc.chat.transcribeAudio.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });

  return {
    cancelGenerationMutation,
    createChatMutation,
    editUserMessageMutation,
    generateTitleMutation,
    regenerateResponseMutation,
    resolveComposeToolMutation,
    sendMessageMutation,
    transcribeAudioMutation,
  };
};

const useChatModelSelection = ({
  chatData,
  chatKey,
  defaultModel,
}: {
  chatData: ChatQueryData | undefined;
  chatKey: string;
  defaultModel: ChatModel;
}) => {
  const [modelSelection, setModelSelection] = useState<{
    chatKey: string;
    model: ChatModel;
  } | null>(null);
  const selectedModel = modelSelection?.model;
  const selectedChatKey = modelSelection?.chatKey;
  let model = defaultModel;
  if (selectedChatKey === chatKey && selectedModel !== undefined) {
    model = selectedModel;
  } else if (
    (chatData?.messages.length ?? 0) > 0 &&
    chatData?.lastModel !== null &&
    chatData?.lastModel !== undefined
  ) {
    model = chatData.lastModel;
  }

  const handleModelChange = (nextModel: ChatModel) => {
    setDefaultChatModel(nextModel);
    setModelSelection({ chatKey, model: nextModel });
  };

  return { handleModelChange, model };
};

const useChatViewStream = ({
  chatData,
  chatId,
  mailboxId,
  queryClient,
  setStreamRunId,
  setStreamingAssistant,
  streamRunId,
  streamingAssistant,
}: {
  chatData: ChatQueryData | undefined;
  chatId: string | null;
  mailboxId: string;
  queryClient: ReturnType<typeof useQueryClient>;
  setStreamRunId: (value: string | null) => void;
  setStreamingAssistant: (
    value: { messageId: string; parts: ChatMessagePart[] } | null
  ) => void;
  streamRunId: string | null;
  streamingAssistant: { messageId: string; parts: ChatMessagePart[] } | null;
}) => {
  const streamChatIdRef = useRef<string | null>(null);
  const activeRun = chatData?.activeRun ?? null;

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
        : current
    );
    void persistQueryByKey(queryKey, queryClient);

    setStreamRunId(result.runId);
    setStreamingAssistant({
      messageId: result.assistantMessageId,
      parts: [{ content: "", type: "text" }],
    });
  };

  const liveRunId =
    streamRunId ?? (isActiveRun(activeRun) ? (activeRun?.id ?? null) : null);
  const liveAssistantMessageId =
    streamingAssistant?.messageId ??
    (isActiveRun(activeRun) ? (activeRun?.assistantMessageId ?? null) : null);
  const liveAssistantParts =
    streamingAssistant?.parts ??
    (hasText(liveAssistantMessageId)
      ? chatData?.messages.find(
          (message) => message.id === liveAssistantMessageId
        )?.parts
      : undefined);

  const commitStreamResult = (
    result: ChatRunStreamDone,
    resolvedChatId?: string | null
  ) => {
    const targetChatId = resolvedChatId ?? streamChatIdRef.current ?? chatId;

    if (!hasText(targetChatId) || !hasText(result.assistantMessageId)) {
      return;
    }

    const queryKey = getChatQueryKey(mailboxId, targetChatId);
    let messageStatus: "cancelled" | "complete" | "failed" = "complete";
    if (result.status === "failed") {
      messageStatus = "failed";
    } else if (result.status === "cancelled") {
      messageStatus = "cancelled";
    }

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
            : message
        ),
      };
    });
    void persistQueryByKey(queryKey, queryClient);
  };

  useChatRunStream({
    assistantMessageId: liveAssistantMessageId,
    enabled: hasText(liveRunId) && hasText(liveAssistantMessageId),
    initialParts: liveAssistantParts,
    onDone: (result) => {
      commitStreamResult(result);
      const resolvedChatId = streamChatIdRef.current ?? chatId;
      setStreamRunId(null);
      setStreamingAssistant(null);
      streamChatIdRef.current = null;

      if (hasText(resolvedChatId)) {
        void queryClient.invalidateQueries({
          queryKey: getChatQueryKey(mailboxId, resolvedChatId),
        });
        queryClient.setQueryData<ChatsQueryData>(
          getChatsQueryKey(mailboxId),
          (current) =>
            current?.map((chat) =>
              chat.id === resolvedChatId
                ? { ...chat, isGenerating: false }
                : chat
            )
        );
      }
    },
    onDraft: ({ assistantMessageId, parts }) => {
      setStreamingAssistant({ messageId: assistantMessageId, parts });
    },
    onError: (message) => {
      toast.error(message);
      const resolvedChatId = streamChatIdRef.current ?? chatId;

      if (hasText(resolvedChatId)) {
        const queryKey = getChatQueryKey(mailboxId, resolvedChatId);
        queryClient.setQueryData<ChatQueryData>(queryKey, (current) =>
          current ? { ...current, activeRun: null } : current
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

  return {
    activeRun,
    beginAssistantStream,
    commitStreamResult,
    liveAssistantMessageId,
    liveAssistantParts,
    liveRunId,
    streamChatIdRef,
  };
};

type ChatAudioRecorder = {
  isRecording: boolean;
  isSupported: boolean;
  start: () => Promise<void>;
  stop: () => Promise<{
    base64: string;
    blob: Blob;
    durationMs: number;
    mimeType: string;
  }>;
};

const useChatViewActions = ({
  activeMailbox,
  activeRun,
  audioRecorder,
  beginAssistantStream,
  chatId,
  composerDisabled,
  commitStreamResult,
  input,
  isActionPending,
  isPreparingTranscription,
  isStreaming,
  mailContext,
  mailboxId,
  model,
  mutations,
  onChatIdChange,
  queryClient,
  setInput,
  setIsPreparingTranscription,
  setStreamRunId,
  setStreamingAssistant,
  streamChatIdRef,
  streamingAssistant,
}: {
  activeMailbox: ChatViewProps["activeMailbox"];
  activeRun: ActiveChatRun | null;
  audioRecorder: ChatAudioRecorder;
  beginAssistantStream: (result: ChatRunStartResult) => void;
  chatId: string | null;
  composerDisabled: boolean;
  commitStreamResult: (
    result: ChatRunStreamDone,
    resolvedChatId?: string | null
  ) => void;
  input: string;
  isActionPending: boolean;
  isPreparingTranscription: boolean;
  isStreaming: boolean;
  mailContext: ChatViewProps["mailContext"];
  mailboxId: string;
  model: ChatModel;
  mutations: ChatViewMutationSet;
  onChatIdChange: ChatViewProps["onChatIdChange"];
  queryClient: ReturnType<typeof useQueryClient>;
  setInput: (value: string | ((current: string) => string)) => void;
  setIsPreparingTranscription: (value: boolean) => void;
  setStreamRunId: (value: string | null) => void;
  setStreamingAssistant: (
    value: { messageId: string; parts: ChatMessagePart[] } | null
  ) => void;
  streamChatIdRef: { current: string | null };
  streamingAssistant: { messageId: string; parts: ChatMessagePart[] } | null;
}) => {
  const submitPrompt = async () => {
    const prompt = input.trim();
    if (
      prompt === "" ||
      isStreaming ||
      isActionPending ||
      isPreparingTranscription ||
      composerDisabled ||
      audioRecorder.isRecording
    ) {
      return;
    }

    try {
      let nextChatId = chatId;
      if (!hasText(nextChatId)) {
        const createdChat = await mutations.createChatMutation.mutateAsync({
          mailboxId,
        });
        nextChatId = createdChat.id;
        onChatIdChange(nextChatId);
      }

      const result = await mutations.sendMessageMutation.mutateAsync({
        category: activeMailbox,
        chatId: nextChatId,
        context: mailContext,
        mailboxId,
        message: prompt,
        model,
      });

      mutations.generateTitleMutation.mutate({
        chatId: nextChatId,
        mailboxId,
        message: prompt,
      });
      beginAssistantStream(result);
      setInput("");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not send message."
      );
    }
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (isStreaming || isActionPending || isPreparingTranscription) {
      return;
    }
    void submitPrompt();
  };

  const stop = async () => {
    const activeChatId = streamChatIdRef.current ?? chatId;

    if (!hasText(activeChatId) || !isStreaming) {
      return;
    }

    const queryKey = getChatQueryKey(mailboxId, activeChatId);
    const assistantMessageId =
      streamingAssistant?.messageId ?? activeRun?.assistantMessageId;
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
                : message
            ),
          }
        : current
    );
    void persistQueryByKey(queryKey, queryClient);
    setStreamRunId(null);
    setStreamingAssistant(null);
    streamChatIdRef.current = null;

    try {
      const result = await mutations.cancelGenerationMutation.mutateAsync({
        chatId: activeChatId,
        mailboxId,
      });
      if (result.cancelled) {
        commitStreamResult(
          {
            assistantMessageId: result.assistantMessageId,
            error: result.error,
            parts: result.parts,
            status: result.status,
          },
          activeChatId
        );
      }
      await queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(mailboxId),
      });
    } catch {
      toast.error(
        "The response could not be stopped. Its status is being refreshed."
      );
      await queryClient.invalidateQueries({ queryKey });
    }
  };

  const handleRecordingStartAsync = async () => {
    if (composerDisabled || isPreparingTranscription) {
      return;
    }

    if (!audioRecorder.isSupported) {
      toast.error("Audio recording is not supported in this browser.");
      return;
    }

    try {
      await audioRecorder.start();
    } catch {
      toast.error("Could not start recording.");
    }
  };

  const handleRecordingStopAsync = async () => {
    setIsPreparingTranscription(true);
    try {
      const nativeRecording = await audioRecorder.stop();
      if (nativeRecording.durationMs > MAX_TRANSCRIPTION_AUDIO_DURATION_MS) {
        toast.error("Recordings must be 60 seconds or shorter.");
        return;
      }

      const recording = await normalizeTranscriptionRecording(nativeRecording);
      const format = getTranscriptionAudioFormat(recording.mimeType);

      if (!format) {
        toast.error("This recording could not be prepared for transcription.");
        return;
      }

      if (recording.base64.length > MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH) {
        toast.error("This recording is too large to transcribe.");
        return;
      }

      const result = await mutations.transcribeAudioMutation.mutateAsync({
        audioBase64: recording.base64,
        chatId: chatId ?? undefined,
        durationMs: recording.durationMs,
        format,
        mailboxId,
      });
      setInput((current) =>
        current.trim() ? `${current.trimEnd()}\n${result.text}` : result.text
      );
    } catch (error: unknown) {
      toast.error(
        error instanceof Error &&
          (error.message.startsWith("Transcription ") ||
            error.message.startsWith("We could not transcribe ") ||
            error.message === "No speech was detected.")
          ? error.message
          : "We could not transcribe that recording. Try recording it again."
      );
    } finally {
      setIsPreparingTranscription(false);
    }
  };

  const handleStop = () => {
    void stop();
  };
  const handleRecordingStart = () => {
    void handleRecordingStartAsync();
  };
  const handleRecordingStop = () => {
    void handleRecordingStopAsync();
  };

  const handleEditSubmit = async (userMessageId: string, message: string) => {
    if (
      !hasText(chatId) ||
      isStreaming ||
      isActionPending ||
      composerDisabled
    ) {
      return;
    }

    try {
      const result = await mutations.editUserMessageMutation.mutateAsync({
        category: activeMailbox,
        chatId,
        context: mailContext,
        mailboxId,
        message,
        model,
        userMessageId,
      });

      beginAssistantStream(result);
      void queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(mailboxId),
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not edit message."
      );
    }
  };

  const handleRegenerate = async (assistantMessageId: string) => {
    if (
      !hasText(chatId) ||
      isStreaming ||
      isActionPending ||
      composerDisabled
    ) {
      return;
    }

    try {
      const result = await mutations.regenerateResponseMutation.mutateAsync({
        assistantMessageId,
        category: activeMailbox,
        chatId,
        context: mailContext,
        mailboxId,
        model,
      });

      beginAssistantStream(result);
      void queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(mailboxId),
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not regenerate response."
      );
    }
  };

  const handleResolveCompose = async (
    composeInput: ResolveComposeToolInput
  ) => {
    if (
      !hasText(chatId) ||
      isStreaming ||
      isActionPending ||
      composerDisabled
    ) {
      return;
    }

    try {
      const result =
        composeInput.action === "decline"
          ? await mutations.resolveComposeToolMutation.mutateAsync({
              action: composeInput.action,
              assistantMessageId: composeInput.assistantMessageId,
              category: activeMailbox,
              chatId,
              context: mailContext,
              mailboxId,
              model,
              toolCallId: composeInput.toolCallId,
            })
          : await mutations.resolveComposeToolMutation.mutateAsync({
              action: composeInput.action,
              assistantMessageId: composeInput.assistantMessageId,
              category: activeMailbox,
              chatId,
              context: mailContext,
              mailboxId,
              message: composeInput.message,
              model,
              toolCallId: composeInput.toolCallId,
            });

      beginAssistantStream(result);
      void queryClient.invalidateQueries({
        queryKey: getChatsQueryKey(mailboxId),
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not complete the email."
      );
    }
  };

  return {
    handleEditSubmit,
    handleInputKeyDown,
    handleRecordingStart,
    handleRecordingStop,
    handleRegenerate,
    handleResolveCompose,
    handleStop,
    handleSubmit,
  };
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
  const shouldReduceMotion = useReducedMotion();
  const { data: billing, isPending: isBillingPending } = useQuery(
    userBillingQueryOptions()
  );
  const [input, setInput] = useState("");
  const defaultModel = useDefaultChatModel();
  const [streamRunId, setStreamRunId] = useState<string | null>(null);
  const [streamingAssistant, setStreamingAssistant] = useState<{
    messageId: string;
    parts: ChatMessagePart[];
  } | null>(null);
  const [isPreparingTranscription, setIsPreparingTranscription] =
    useState(false);
  const { data: chatData } = useQuery({
    ...chatQueryOptions(mailboxId, chatId),
    refetchOnWindowFocus: true,
  });
  const chatKey = chatId ?? draftChatKey;
  const { handleModelChange, model } = useChatModelSelection({
    chatData,
    chatKey,
    defaultModel,
  });
  const audioRecorder = useAudioRecorder({
    mimeType: "audio/webm;codecs=opus",
    onComplete: ({ base64, blob, durationMs, mimeType }) =>
      ({
        base64,
        blob,
        durationMs,
        mimeType,
      }) satisfies BrowserAudioRecording,
    onError: () => {
      toast.error("Could not access your microphone.");
    },
  });
  const mutations = useChatViewMutations({ mailboxId, queryClient });
  const {
    cancelGenerationMutation,
    createChatMutation,
    editUserMessageMutation,
    generateTitleMutation,
    regenerateResponseMutation,
    resolveComposeToolMutation,
    sendMessageMutation,
    transcribeAudioMutation,
  } = mutations;
  const chatStream = useChatViewStream({
    chatData,
    chatId,
    mailboxId,
    queryClient,
    setStreamRunId,
    setStreamingAssistant,
    streamRunId,
    streamingAssistant,
  });
  const {
    activeRun,
    beginAssistantStream,
    commitStreamResult,
    liveRunId,
    streamChatIdRef,
  } = chatStream;

  const visibleMessages = (
    chatData ? normalizeChatMessages(chatData.messages) : []
  ).map((message) =>
    message.id === streamingAssistant?.messageId
      ? {
          ...message,
          parts: isUiMessagePartArray(streamingAssistant.parts)
            ? streamingAssistant.parts
            : [],
        }
      : message
  );
  const turns = createChatTurns(visibleMessages);
  const isStreaming = hasText(liveRunId);
  const hasMessages = visibleMessages.length > 0 || hasText(chatId);
  const isTranscribingAudio =
    isPreparingTranscription || transcribeAudioMutation.isPending;
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
  const errorMessage =
    activeRun?.error ?? chatData?.messages.at(-1)?.error ?? undefined;

  const chatActions = useChatViewActions({
    activeMailbox,
    activeRun,
    audioRecorder,
    beginAssistantStream,
    chatId,
    commitStreamResult,
    composerDisabled,
    input,
    isActionPending,
    isPreparingTranscription,
    isStreaming,
    mailContext,
    mailboxId,
    model,
    mutations: {
      cancelGenerationMutation,
      createChatMutation,
      editUserMessageMutation,
      generateTitleMutation,
      regenerateResponseMutation,
      resolveComposeToolMutation,
      sendMessageMutation,
      transcribeAudioMutation,
    },
    onChatIdChange,
    queryClient,
    setInput,
    setIsPreparingTranscription,
    setStreamRunId,
    setStreamingAssistant,
    streamChatIdRef,
    streamingAssistant,
  });
  const {
    handleEditSubmit,
    handleInputKeyDown,
    handleRecordingStart,
    handleRecordingStop,
    handleRegenerate,
    handleResolveCompose,
    handleStop,
    handleSubmit,
  } = chatActions;

  return (
    <ChatViewLayout
      chatId={chatId ?? null}
      chatTitle={chatData?.title}
      composer={{
        canUseAiChat,
        disabled: composerDisabled,
        input,
        isBillingPending,
        mailboxOrganizationId,
        model,
        onInputChange: setInput,
        onInputKeyDown: handleInputKeyDown,
        onModelChange: handleModelChange,
        onRecordingStart: handleRecordingStart,
        onRecordingStop: handleRecordingStop,
        onStop: handleStop,
        onSubmit: handleSubmit,
        recording: audioRecorder.isRecording,
        recordingSupported: audioRecorder.isSupported,
        requirementLabel: aiRequirement.requirementLabel,
        streaming: isStreaming,
        submitting: isActionPending,
        transcribing: isTranscribingAudio,
      }}
      draftChatKey={draftChatKey}
      hasMessages={hasMessages}
      onOpenSidebar={onOpenSidebar}
      shouldReduceMotion={shouldReduceMotion}
      transcript={{
        actionsDisabled: isStreaming || isActionPending || composerDisabled,
        errorMessage,
        hydrated: chatData !== undefined,
        isStreaming,
        onCopy: (text) => {
          void copyToClipboard(text);
        },
        onEditSubmit: (messageId, message) => {
          void handleEditSubmit(messageId, message);
        },
        onRegenerate: (messageId) => {
          void handleRegenerate(messageId);
        },
        onResolveCompose: handleResolveCompose,
        turns,
      }}
    />
  );
};
