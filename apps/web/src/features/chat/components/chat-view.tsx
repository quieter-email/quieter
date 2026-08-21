"use client";

import {
  aiMemoryToolDef,
  composeEmailInputSchema,
  composeEmailToolDef,
  googleCalendarCreateEventToolDef,
  modifyMailToolDef,
} from "@quieter/ai/chat-agent";
import type { ChatModel } from "@quieter/ai/chat-models";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";
import {
  fetchServerSentEvents,
  useAudioRecorder,
  useChat,
} from "@tanstack/ai-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, SubmitEvent } from "react";

import { MobileHeader } from "#/components/mobile-header";
import { getConnectorTokens } from "#/features/ai/domain/connector-tokens";
import {
  setDefaultChatModel,
  useDefaultChatModel,
} from "#/features/ai/domain/default-chat-model-setting";
import {
  hasOrganizationAiAccess,
  USER_BILLING_QUERY_KEY,
  userBillingQueryOptions,
} from "#/features/settings/domain/billing";
import type { BrowserAudioRecording } from "#/lib/audio-transcription";
import {
  getTranscriptionAudioFormat,
  normalizeTranscriptionRecording,
} from "#/lib/audio-transcription";
import {
  chatQueryOptions,
  getChatQueryKey,
  getChatsQueryKey,
} from "#/lib/chat-query";
import { connectorsQueryOptions } from "#/lib/connectors-query";
import { orpc, rpc } from "#/lib/orpc";
import { shouldRetryOrpcError } from "#/lib/orpc-errors";

import { toInitialMessages } from "../domain/chat-messages";
import type { ChatToolApproval } from "../domain/chat-tools";
import type { ChatViewProps } from "../types";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

const fetchChat = Object.assign(
  async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const response = await fetch(input, init);
    if (response.ok) {
      return response;
    }
    const responseText = await response.clone().text();
    const message = responseText.trim();
    if (message === "") {
      return response;
    }
    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
      statusText: message,
    });
  },
  { preconnect: fetch.preconnect }
);

const CHAT_CONNECTION = fetchServerSentEvents("/api/chat", {
  fetchClient: fetchChat,
});
const CHAT_TOOLS = [
  aiMemoryToolDef.client(),
  composeEmailToolDef.client(),
  googleCalendarCreateEventToolDef.client(),
  modifyMailToolDef.client(),
] as const;
const MAX_TRANSCRIPTION_AUDIO_DURATION_MS = 60_000;
const MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH = 14_000_000;
const CHAT_SETTLEMENT_DELAY_MS = 150;
const CHAT_SETTLEMENT_ATTEMPTS = 10;

type ChatData = RouterOutputs["chat"]["get"];
type InitialResumeSnapshot = NonNullable<
  Parameters<typeof useChat>[0]["initialResumeSnapshot"]
>;

const isPendingInterrupt = (
  value: unknown
): value is NonNullable<InitialResumeSnapshot["pendingInterrupts"]>[number] =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "reason" in value &&
  typeof value.reason === "string";

const toInitialResumeSnapshot = (
  value: ChatData["messages"][number]["resume"] | null | undefined
): InitialResumeSnapshot | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.resumeState !== "object" ||
    value.resumeState === null ||
    typeof value.resumeState.runId !== "string" ||
    typeof value.resumeState.threadId !== "string" ||
    !Array.isArray(value.pendingInterrupts) ||
    !value.pendingInterrupts.every(isPendingInterrupt)
  ) {
    return undefined;
  }
  return {
    pendingInterrupts: value.pendingInterrupts,
    resumeState: value.resumeState,
  };
};

const getChatErrorMessage = (
  error: Error | undefined,
  message: ChatData["messages"][number] | undefined,
  isStreaming: boolean
) => {
  if (isStreaming) {
    return "";
  }
  if (message?.status === "failed") {
    return message.error ?? "The answer could not be completed.";
  }
  if (message?.status === "cancelled") {
    return "Answer stopped.";
  }
  if (message?.status === "streaming") {
    return "This answer is still running. Retry if it was interrupted.";
  }
  if (error !== undefined && error.message !== "") {
    return error.message;
  }
  return "";
};

const fetchSettledChat = async (
  queryClient: QueryClient,
  mailboxId: string,
  chatId: string,
  attemptsRemaining = CHAT_SETTLEMENT_ATTEMPTS
): Promise<ChatData> => {
  const persistedChat = await queryClient.fetchQuery(
    chatQueryOptions(mailboxId, chatId)
  );
  if (
    persistedChat.messages.at(-1)?.status !== "streaming" ||
    attemptsRemaining <= 1
  ) {
    return persistedChat;
  }
  // Let the aborted request persist its terminal state before refetching.
  // eslint-disable-next-line promise/avoid-new
  await new Promise<void>((resolve) => {
    setTimeout(resolve, CHAT_SETTLEMENT_DELAY_MS);
  });
  return await fetchSettledChat(
    queryClient,
    mailboxId,
    chatId,
    attemptsRemaining - 1
  );
};

const getChatSessionState = (input: {
  canUseAiChat: boolean;
  isLoading: boolean;
  isPreparingTranscription: boolean;
  persistedStatus: string | undefined;
  resuming: boolean;
  status: string;
  transcriptionPending: boolean;
}) => {
  const isStreaming =
    input.isLoading || input.resuming || input.status === "streaming";
  const isTranscribing =
    input.isPreparingTranscription || input.transcriptionPending;
  const hasPersistedStream =
    input.persistedStatus === "streaming" && !isStreaming;
  return {
    disabled: !input.canUseAiChat || hasPersistedStream,
    isStreaming,
    isTranscribing,
  };
};

const PlanRequired = ({
  organizationId,
  requirementLabel,
}: {
  organizationId: string;
  requirementLabel: string;
}) => {
  const navigate = useNavigate();

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-body text-muted-fg">
      <span>
        AI chat requires {requirementLabel} billing and available credits.
      </span>
      <Button
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
        variant="ghost"
      >
        View plans
      </Button>
    </div>
  );
};

// This component owns one chat client's transport, media, persistence, and composer state.
const ChatSession = ({
  activeMailbox,
  canUseAiChat,
  chatData,
  chatId,
  draftChatKey,
  mailContext,
  mailboxId,
  mailboxOrganizationId,
  onChatIdChange,
  onOpenSidebar,
}: ChatViewProps & {
  canUseAiChat: boolean;
  chatData: ChatData | undefined;
}) => {
  const queryClient = useQueryClient();
  const isCurrentSessionRef = useRef(true);
  const appliedChatRevisionRef = useRef<string | null>(null);
  const defaultModel = useDefaultChatModel();
  const threadId = chatId ?? draftChatKey;
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);
  const [isPreparingTranscription, setIsPreparingTranscription] =
    useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const { data: connectorsData } = useQuery(connectorsQueryOptions());
  const connectorTokens = getConnectorTokens(connectorsData);
  const model = selectedModel ?? defaultModel;
  const transcribeAudio = useMutation({
    ...orpc.chat.transcribeAudio.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });
  const audioRecorder = useAudioRecorder({
    mimeType: "audio/webm;codecs=opus",
    onComplete: ({ base64, blob, durationMs, mimeType }) =>
      ({ base64, blob, durationMs, mimeType }) satisfies BrowserAudioRecording,
    onError: () => {
      toast.error("Could not access your microphone.");
    },
  });
  const {
    error,
    interrupts,
    isLoading,
    messages,
    reload,
    resuming,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat({
    connection: CHAT_CONNECTION,
    forwardedProps: {
      category: activeMailbox,
      ...(mailContext === undefined ? {} : { context: mailContext }),
      mailboxId,
      model,
    },
    initialMessages: toInitialMessages<typeof CHAT_TOOLS>(
      chatData?.messages ?? []
    ),
    initialResumeSnapshot: toInitialResumeSnapshot(
      chatData?.messages.at(-1)?.resume
    ),
    queue: "drop",
    threadId,
    tools: CHAT_TOOLS,
  });
  const approvals: ChatToolApproval[] = interrupts.flatMap((interrupt) => {
    if (interrupt.kind !== "tool-approval") {
      return [];
    }
    return [
      {
        approve: (editedArgs) => {
          if (interrupt.toolName === "compose_email") {
            const parsed = composeEmailInputSchema.safeParse(editedArgs);
            if (parsed.success) {
              interrupt.resolveInterrupt(true, { editedArgs: parsed.data });
              return;
            }
          }
          interrupt.resolveInterrupt(true);
        },
        canResolve: interrupt.canResolve,
        id: interrupt.id,
        originalArgs: interrupt.originalArgs,
        reject: () => {
          interrupt.resolveInterrupt(false);
        },
        status: interrupt.status,
        toolCallId: interrupt.toolCallId,
        toolName: interrupt.toolName,
      },
    ];
  });
  const hasMessages = messages.some((message) => message.role !== "system");
  const persistedLastMessage = chatData?.messages.at(-1);
  const {
    disabled: sessionDisabled,
    isStreaming,
    isTranscribing,
  } = getChatSessionState({
    canUseAiChat,
    isLoading,
    isPreparingTranscription,
    persistedStatus: persistedLastMessage?.status,
    resuming,
    status,
    transcriptionPending: transcribeAudio.isPending,
  });
  const disabled = sessionDisabled || approvals.length > 0 || isRetrying;
  const errorMessage = getChatErrorMessage(
    error,
    persistedLastMessage,
    isStreaming
  );

  useEffect(() => {
    isCurrentSessionRef.current = true;
    return () => {
      isCurrentSessionRef.current = false;
    };
  }, []);

  useEffect(() => {
    const revision = chatData?.updatedAt.toString() ?? null;
    if (
      isStreaming ||
      chatData === undefined ||
      revision === appliedChatRevisionRef.current
    ) {
      return;
    }
    setMessages(toInitialMessages<typeof CHAT_TOOLS>(chatData.messages));
    appliedChatRevisionRef.current = revision;
  }, [chatData, isStreaming, setMessages]);

  // Another tab or device may be generating into this chat. This observer adds
  // polling only while a persisted stream exists and this client is idle; it
  // shares the cache entry above, so no duplicate requests are created.
  useQuery({
    ...chatQueryOptions(mailboxId, chatId),
    refetchInterval: (query) =>
      isStreaming || query.state.data?.messages.at(-1)?.status !== "streaming"
        ? false
        : 1000,
  });

  const synchronizeChat = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) }),
    ]);
    let shouldSelectDraft = false;
    try {
      await fetchSettledChat(queryClient, mailboxId, threadId);
      shouldSelectDraft = true;
    } catch (fetchError) {
      shouldSelectDraft = shouldRetryOrpcError(0, fetchError);
      if (chatId !== null) {
        await queryClient.invalidateQueries({
          queryKey: getChatQueryKey(mailboxId, threadId),
        });
      }
    }
    if (chatId === null && shouldSelectDraft && isCurrentSessionRef.current) {
      onChatIdChange(threadId);
    }
  };

  const submitPrompt = async () => {
    const prompt = input.trim();
    if (
      !prompt ||
      disabled ||
      isLoading ||
      isTranscribing ||
      audioRecorder.isRecording
    ) {
      return;
    }

    setInput("");
    try {
      await sendMessage(prompt);
    } catch (sendError) {
      if (
        isCurrentSessionRef.current &&
        !(sendError instanceof Error && sendError.name === "AbortError")
      ) {
        setInput((current) => current || prompt);
      }
    }
    await synchronizeChat();
  };

  const retryLastTurn = async () => {
    if (isRetrying || isStreaming) {
      return;
    }
    setIsRetrying(true);
    try {
      try {
        const persistedChat = await rpc.chat.get({
          chatId: threadId,
          mailboxId,
        });
        const lastMessage = persistedChat.messages.at(-1);
        if (
          lastMessage?.role === "assistant" &&
          lastMessage.status === "complete"
        ) {
          queryClient.setQueryData(
            getChatQueryKey(mailboxId, threadId),
            persistedChat
          );
          if (chatId === null && isCurrentSessionRef.current) {
            onChatIdChange(threadId);
          }
          return;
        }
      } catch {
        // Reload handles requests that failed before the chat was persisted.
      }
      await reload();
      await synchronizeChat();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void submitPrompt();
  };

  const startRecording = async () => {
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

  const stopRecording = async () => {
    setIsPreparingTranscription(true);
    try {
      const nativeRecording = await audioRecorder.stop();
      if (nativeRecording.durationMs > MAX_TRANSCRIPTION_AUDIO_DURATION_MS) {
        toast.error("Recordings must be 60 seconds or shorter.");
        setIsPreparingTranscription(false);
        return;
      }

      const recording = await normalizeTranscriptionRecording(nativeRecording);
      const format = getTranscriptionAudioFormat(recording.mimeType);
      if (!format) {
        toast.error("This recording could not be prepared for transcription.");
        setIsPreparingTranscription(false);
        return;
      }
      if (recording.base64.length > MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH) {
        toast.error("This recording is too large to transcribe.");
        setIsPreparingTranscription(false);
        return;
      }

      const result = await transcribeAudio.mutateAsync({
        audioBase64: recording.base64,
        chatId: chatId ?? undefined,
        durationMs: recording.durationMs,
        format,
        mailboxId,
      });
      setInput((current) =>
        current.trim() ? `${current.trimEnd()}\n${result.text}` : result.text
      );
    } catch (transcriptionError) {
      toast.error(
        transcriptionError instanceof Error &&
          (transcriptionError.message.startsWith("Transcription ") ||
            transcriptionError.message.startsWith("We could not transcribe ") ||
            transcriptionError.message === "No speech was detected.")
          ? transcriptionError.message
          : "We could not transcribe that recording. Try recording it again."
      );
    }
    setIsPreparingTranscription(false);
  };

  const composer = (
    <div className="mx-auto w-full max-w-2xl">
      {canUseAiChat ? null : (
        <PlanRequired
          organizationId={mailboxOrganizationId}
          requirementLabel={BILLING_FEATURES.aiChat.requirementLabel}
        />
      )}
      <ChatComposer
        connectorTokens={connectorTokens}
        disabled={disabled}
        input={input}
        model={model}
        onInputChange={setInput}
        onInputKeyDown={handleInputKeyDown}
        onModelChange={(nextModel) => {
          setDefaultChatModel(nextModel);
          setSelectedModel(nextModel);
        }}
        onRecordingStart={() => {
          void startRecording();
        }}
        onRecordingStop={() => {
          void stopRecording();
        }}
        onStop={stop}
        onSubmit={handleSubmit}
        recording={audioRecorder.isRecording}
        recordingSupported={audioRecorder.isSupported}
        streaming={isStreaming}
        submitting={status === "submitted"}
        transcribing={isTranscribing}
      />
    </div>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MobileHeader
        leading="sidebar"
        onLeadingClick={onOpenSidebar}
        title={hasMessages ? (chatData?.title ?? undefined) : undefined}
      />
      {hasMessages &&
      chatData?.title !== null &&
      chatData?.title !== undefined &&
      chatData.title !== "" ? (
        <header className="hidden shrink-0 border-b border-border px-5 py-3 lg:block">
          <h1 className="truncate text-body font-medium tracking-tight">
            {chatData.title}
          </h1>
        </header>
      ) : null}
      {hasMessages ? (
        <>
          <ChatTranscript
            approvals={approvals}
            errorMessage={errorMessage}
            isStreaming={isStreaming}
            messages={messages}
            onRetry={() => {
              void retryLastTurn();
            }}
            retrying={isRetrying}
            resuming={resuming}
          />
          <div className="shrink-0 px-4 pb-4 sm:px-6 lg:pb-6">{composer}</div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-12 sm:px-6">
          <p className="mb-5 text-body text-muted-fg">Ask about your mail</p>
          {composer}
        </div>
      )}
    </section>
  );
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
  const { data: billing, isPending: isBillingPending } = useQuery(
    userBillingQueryOptions()
  );
  const chatQuery = useQuery(chatQueryOptions(mailboxId, chatId));
  const canUseAiChat = billing
    ? hasOrganizationAiAccess(billing, mailboxOrganizationId)
    : true;

  if (chatId !== null && chatQuery.isPending) {
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <MobileHeader leading="sidebar" onLeadingClick={onOpenSidebar} />
        <p className="m-auto text-body text-muted-fg">Loading conversation…</p>
      </section>
    );
  }

  if (chatId !== null && chatQuery.isError) {
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <MobileHeader leading="sidebar" onLeadingClick={onOpenSidebar} />
        <div className="m-auto flex items-center gap-3 text-body text-muted-fg">
          <span>Could not load this conversation.</span>
          <Button
            onClick={() => {
              void chatQuery.refetch();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Try again
          </Button>
        </div>
      </section>
    );
  }

  return (
    <ChatSession
      key={`${mailboxId}:${chatId ?? draftChatKey}`}
      activeMailbox={activeMailbox}
      canUseAiChat={isBillingPending || canUseAiChat}
      chatData={chatQuery.data}
      chatId={chatId}
      draftChatKey={draftChatKey}
      mailContext={mailContext}
      mailboxId={mailboxId}
      mailboxOrganizationId={mailboxOrganizationId}
      onChatIdChange={onChatIdChange}
      onOpenSidebar={onOpenSidebar}
    />
  );
};
