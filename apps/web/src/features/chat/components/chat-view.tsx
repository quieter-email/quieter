"use client";

import { useChat } from "@ai-sdk/react";
import type { ComposeEmailResult } from "@quieter/ai/chat-agent";
import type { ChatModel } from "@quieter/ai/chat-models";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useAudioRecorder } from "#/lib/audio-recorder";
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
import { toastError } from "#/lib/error-toast";
import { orpc, rpc } from "#/lib/orpc";
import { shouldRetryOrpcError } from "#/lib/orpc-errors";

import { getChatRetryAction, toInitialMessages } from "../domain/chat-messages";
import type { ChatToolApproval } from "../domain/chat-tools";
import { getToolName, isChatToolPart } from "../domain/chat-tools";
import { toChatComposeMessageInput } from "../domain/compose-proposal";
import type { ComposeValues } from "../domain/compose-proposal";
import type { ChatViewProps } from "../types";
import { ChatComposer } from "./chat-composer";
import { ChatTranscript } from "./chat-transcript";

const CHAT_API_ENDPOINT = "/api/chat";
const MAX_TRANSCRIPTION_AUDIO_DURATION_MS = 60_000;
const MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH = 14_000_000;

type ChatData = RouterOutputs["chat"]["get"];

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

// This component owns one chat session's transport, media, persistence, and composer state.
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
  const composeResolutionRef = useRef(false);
  const retryPendingRef = useRef(false);
  const submitPendingRef = useRef(false);
  const defaultModel = useDefaultChatModel();
  const threadId = chatId ?? draftChatKey;
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);
  const [isPreparingTranscription, setIsPreparingTranscription] =
    useState(false);
  const [isResolvingCompose, setIsResolvingCompose] = useState(false);
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
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: CHAT_API_ENDPOINT,
        prepareSendMessagesRequest: ({ messages, trigger }) => ({
          body: {
            category: activeMailbox,
            ...(mailContext === undefined ? {} : { context: mailContext }),
            mailboxId,
            message: messages.at(-1),
            model,
            threadId,
            trigger,
          },
        }),
      }),
    [activeMailbox, mailContext, mailboxId, model, threadId]
  );

  const synchronizeChat = async () => {
    const [chatResult] = await Promise.allSettled([
      queryClient.fetchQuery({
        ...chatQueryOptions(mailboxId, threadId),
        staleTime: 0,
      }),
      queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: getChatsQueryKey(mailboxId) }),
    ]);
    const shouldSelectDraft =
      chatResult?.status === "fulfilled" ||
      (chatResult?.status === "rejected" &&
        shouldRetryOrpcError(0, chatResult.reason));
    if (chatId === null && shouldSelectDraft && isCurrentSessionRef.current) {
      onChatIdChange(threadId);
    }
  };

  const {
    addToolApprovalResponse,
    addToolOutput,
    clearError,
    error,
    messages,
    regenerate,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat({
    id: threadId,
    messages: toInitialMessages(chatData?.messages ?? []),
    onFinish: () => {
      void synchronizeChat();
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    throttle: 50,
    transport,
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const isTranscribing = isPreparingTranscription || transcribeAudio.isPending;

  const approvals: ChatToolApproval[] = messages.flatMap((message) =>
    message.role === "assistant"
      ? message.parts.flatMap((part) => {
          if (
            !isChatToolPart(part) ||
            part.state !== "approval-requested" ||
            part.approval === undefined ||
            part.approval.isAutomatic === true
          ) {
            return [];
          }
          const approvalId = part.approval.id;
          return [
            {
              approve: () => {
                void addToolApprovalResponse({
                  approved: true,
                  id: approvalId,
                });
              },
              deny: () => {
                void addToolApprovalResponse({
                  approved: false,
                  id: approvalId,
                });
              },
              id: approvalId,
              toolCallId: part.toolCallId,
              toolName: getToolName(part.type),
            },
          ];
        })
      : []
  );

  const disabled =
    !canUseAiChat ||
    approvals.length > 0 ||
    isRetrying ||
    isResolvingCompose ||
    isStreaming ||
    isTranscribing ||
    audioRecorder.isRecording;
  const errorMessage = (() => {
    if (isStreaming) {
      return "";
    }
    if (error !== undefined && error.message !== "") {
      return error.message;
    }
    return "";
  })();

  useEffect(() => {
    isCurrentSessionRef.current = true;
    return () => {
      isCurrentSessionRef.current = false;
    };
  }, []);

  // Reconcile with the server copy whenever a fresh one arrives while this
  // session is idle (after sends, retries, or external chat changes).
  useEffect(() => {
    if (status !== "ready" || chatData === undefined) {
      return;
    }
    setMessages(toInitialMessages(chatData.messages));
  }, [chatData, setMessages, status]);

  const resolveCompose = async (
    toolCallId: string,
    action: "decline" | "save_draft" | "send",
    values?: ComposeValues
  ) => {
    if (composeResolutionRef.current) {
      return;
    }
    composeResolutionRef.current = true;
    setIsResolvingCompose(true);
    let output: ComposeEmailResult;
    try {
      if (action === "decline" || values === undefined) {
        output = { status: "declined" };
      } else {
        const composeInput = toChatComposeMessageInput(values);
        if (action === "save_draft") {
          const draft = await rpc.mail.saveDraft({
            draft: composeInput,
            mailboxId,
          });
          output = {
            draftId: draft.draftId,
            ...(draft.messageId === null ? {} : { messageId: draft.messageId }),
            status: "draft_saved",
            subject: values.subject,
            to: values.to,
          };
        } else {
          const sent = await rpc.mail.sendMessage({
            mailboxId,
            message: composeInput,
          });
          output = {
            messageId: sent.id,
            status: "sent",
            subject: values.subject,
            ...(sent.threadId === undefined ? {} : { threadId: sent.threadId }),
            to: values.to,
          };
        }
      }
    } catch (composeError) {
      const errorText =
        action === "save_draft"
          ? "The draft could not be saved."
          : "The email could not be sent.";
      toastError(composeError, {
        boundary: "chat-compose",
        fallback: errorText,
      });
      addToolOutput({
        errorText,
        state: "output-error",
        tool: "compose_email",
        toolCallId,
      });
      await sendMessage();
      composeResolutionRef.current = false;
      setIsResolvingCompose(false);
      return;
    }
    addToolOutput({ output, tool: "compose_email", toolCallId });
    await sendMessage();
    composeResolutionRef.current = false;
    setIsResolvingCompose(false);
  };

  const submitPrompt = async () => {
    const prompt = input.trim();
    if (!prompt || disabled || submitPendingRef.current) {
      return;
    }

    submitPendingRef.current = true;
    clearError();
    setInput("");
    await sendMessage({ text: prompt });
    submitPendingRef.current = false;
  };

  const retryLastTurn = async () => {
    if (isRetrying || isStreaming || retryPendingRef.current) {
      return;
    }
    retryPendingRef.current = true;
    setIsRetrying(true);
    let retryFailure: unknown;
    try {
      const persistedChat = await rpc.chat.get({ chatId: threadId, mailboxId });
      const persistedMessages = toInitialMessages(persistedChat.messages);
      const retryAction = getChatRetryAction(messages, persistedMessages);
      if (retryAction.type === "resubmit-user") {
        clearError();
        await sendMessage({
          messageId: retryAction.messageId,
          text: retryAction.text,
        });
      } else if (retryAction.type === "unavailable") {
        toast.error(
          "The answer could not be retried. Send your message again."
        );
      } else {
        clearError();
        queryClient.setQueryData(
          getChatQueryKey(mailboxId, threadId),
          persistedChat
        );
        setMessages(persistedMessages);
        if (retryAction.type === "regenerate") {
          await regenerate();
        }
      }
    } catch (retryError) {
      retryFailure = retryError;
    }
    if (retryFailure !== undefined) {
      const errorCode =
        retryFailure !== null &&
        typeof retryFailure === "object" &&
        "code" in retryFailure
          ? retryFailure.code
          : undefined;
      const errorStatus =
        retryFailure !== null &&
        typeof retryFailure === "object" &&
        "status" in retryFailure
          ? retryFailure.status
          : undefined;
      if (errorCode !== "NOT_FOUND" && errorStatus !== 404) {
        toastError(retryFailure, {
          boundary: "chat-retry",
          fallback: "The answer could not be retried. Try again.",
        });
      } else {
        const retryAction = getChatRetryAction(messages, []);
        if (retryAction.type === "resubmit-user") {
          clearError();
          await sendMessage({
            messageId: retryAction.messageId,
            text: retryAction.text,
          });
        } else {
          toast.error(
            "The answer could not be retried. Send your message again."
          );
        }
      }
    }
    retryPendingRef.current = false;
    setIsRetrying(false);
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
      toast.error("Could not access your microphone.");
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
        onStop={() => {
          void stop();
        }}
        onSubmit={handleSubmit}
        recording={audioRecorder.isRecording}
        recordingSupported={audioRecorder.isSupported}
        streaming={isStreaming}
        submitting={status === "submitted"}
        transcribing={isTranscribing}
      />
    </div>
  );

  const hasVisibleMessages = messages.some(
    (message) => message.role !== "system"
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MobileHeader
        leading="sidebar"
        onLeadingClick={onOpenSidebar}
        title={hasVisibleMessages ? (chatData?.title ?? undefined) : undefined}
      />
      {hasVisibleMessages &&
      chatData?.title !== null &&
      chatData?.title !== undefined &&
      chatData.title !== "" ? (
        <header className="hidden shrink-0 border-b border-border px-5 py-3 lg:block">
          <h1 className="truncate text-body font-medium tracking-tight">
            {chatData.title}
          </h1>
        </header>
      ) : null}
      {hasVisibleMessages ? (
        <>
          <ChatTranscript
            approvals={approvals}
            composeBusy={isResolvingCompose}
            errorMessage={errorMessage}
            isStreaming={isStreaming}
            messages={messages}
            onComposeDecline={(toolCallId) => {
              void resolveCompose(toolCallId, "decline");
            }}
            onComposeSubmit={(toolCallId, action, values) => {
              void resolveCompose(toolCallId, action, values);
            }}
            onRetry={() => {
              void retryLastTurn();
            }}
            retrying={isRetrying}
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
