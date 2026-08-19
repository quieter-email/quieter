"use client";

import { BILLING_FEATURES } from "@quieter/billing/plans";
import { toast } from "@quieter/ui/toast";
import { useAudioRecorder } from "@tanstack/ai-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";

import { getConnectorTokens } from "#/features/ai/domain/connector-tokens";
import { useDefaultChatModel } from "#/features/ai/domain/default-chat-model-setting";
import {
  hasOrganizationAiAccess,
  userBillingQueryOptions,
} from "#/features/settings/domain/billing";
import type { BrowserAudioRecording } from "#/lib/audio-transcription";
import { chatQueryOptions } from "#/lib/chat-query";
import { connectorsQueryOptions } from "#/lib/connectors-query";

import {
  chatRunStore,
  isChatRunActiveLocallyForState,
} from "../chat-run-store";
import { createChatTurns } from "../domain/chat-turns";
import { useChatModelSelection } from "../hooks/use-chat-model-selection";
import { useChatViewActions } from "../hooks/use-chat-view-actions";
import { useChatViewMutations } from "../hooks/use-chat-view-mutations";
import { useChatViewStream } from "../hooks/use-chat-view-stream";
import {
  copyToClipboard,
  createPendingTurn,
  hasPendingChatAction,
  hasText,
  isActiveRun,
  isUiMessagePartArray,
  normalizeChatMessages,
} from "../lib/chat-view-helpers";
import type { ChatViewProps } from "../types";
import { ChatViewLayout } from "./chat-view-layout";

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
  const { data: connectorsData } = useQuery(connectorsQueryOptions());
  const connectorTokens = useMemo(
    () => getConnectorTokens(connectorsData),
    [connectorsData]
  );
  const defaultModel = useDefaultChatModel();
  const [isPreparingTranscription, setIsPreparingTranscription] =
    useState(false);
  const { pendingPrompt, streamingAssistant } = useSelector(
    chatRunStore,
    (state) => state
  );

  const { data: chatData } = useQuery({
    ...chatQueryOptions(mailboxId, chatId),
    refetchOnWindowFocus: (query) => {
      // A live stream is the source of truth while generating, and a locally failed run
      // must not be re-imported on every focus (that drove the reconnect/error storm).
      // Check via selector state to avoid direct `chatRunStore.state` in render; for this
      // non-reactive predicate we read the store snapshot.
      if (
        isChatRunActiveLocallyForState(chatId, mailboxId, chatRunStore.state)
      ) {
        return false;
      }
      const { data } = query.state;
      return !isActiveRun(data?.activeRun);
    },
    staleTime: 30_000,
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
  const chatStream = useChatViewStream({
    chatData,
    chatId,
    mailboxId,
    model,
    queryClient,
  });
  const { activeRun, beginAssistantStream, commitStreamResult, liveRunId } =
    chatStream;

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
  const pendingTurn = createPendingTurn(pendingPrompt, chatKey, mailboxId);
  const turns = [
    ...createChatTurns(visibleMessages),
    ...(pendingTurn === null ? [] : [pendingTurn]),
  ];
  const isStreaming = hasText(liveRunId) || pendingTurn !== null;
  const hasMessages = turns.length > 0 || hasText(chatId);
  const isTranscribingAudio =
    isPreparingTranscription || mutations.transcribeAudioMutation.isPending;
  const isActionPending = hasPendingChatAction(mutations);
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
    draftChatKey,
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
        connectorTokens,
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
