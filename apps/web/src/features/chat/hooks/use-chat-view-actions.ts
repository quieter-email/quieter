"use client";

import type { ChatModel } from "@quieter/ai/chat-models";
import { toast } from "@quieter/ui/toast";
import type { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import type { KeyboardEvent, SubmitEvent } from "react";

import {
  getTranscriptionAudioFormat,
  normalizeTranscriptionRecording,
} from "#/lib/audio-transcription";
import { getChatQueryKey, getChatsQueryKey } from "#/lib/chat-query";

import {
  chatRunStore,
  commitChatRunStream,
  setChatPendingPrompt,
} from "../chat-run-store";
import {
  hasText,
  MAX_TRANSCRIPTION_AUDIO_BASE64_LENGTH,
  MAX_TRANSCRIPTION_AUDIO_DURATION_MS,
} from "../lib/chat-view-helpers";
import type {
  ActiveChatRun,
  ChatQueryData,
  ChatRunStartResult,
  ChatViewMutationSet,
} from "../lib/chat-view-helpers";
import type { ChatViewProps, ResolveComposeToolInput } from "../types";
import type { ChatRunStreamDone } from "./use-chat-run-stream";

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

export const useChatViewActions = ({
  activeMailbox,
  activeRun,
  audioRecorder,
  beginAssistantStream,
  chatId,
  composerDisabled,
  commitStreamResult,
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
}: {
  activeMailbox: ChatViewProps["activeMailbox"];
  activeRun: ActiveChatRun | null;
  audioRecorder: ChatAudioRecorder;
  beginAssistantStream: (result: ChatRunStartResult) => void;
  chatId: string | null;
  composerDisabled: boolean;
  draftChatKey: string;
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
}) => {
  const { streamChatId, streamingAssistant } = useSelector(
    chatRunStore,
    (state) => state
  );
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

    // Paint the turn before the round trip so the transcript is never blank while the
    // chat record, the run, and its first tokens are still being created.
    setChatPendingPrompt({
      chatKey: chatId ?? draftChatKey,
      mailboxId,
      text: prompt,
    });
    setInput("");

    try {
      let nextChatId = chatId;
      if (!hasText(nextChatId)) {
        const createdChat = await mutations.createChatMutation.mutateAsync({
          mailboxId,
        });
        nextChatId = createdChat.id;
        onChatIdChange(nextChatId);
        setChatPendingPrompt({ chatKey: nextChatId, mailboxId, text: prompt });
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
    } catch (error) {
      setChatPendingPrompt(null);
      setInput(prompt);
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

  const handleInputKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
    const activeChatId = streamChatId ?? chatId;

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
    commitChatRunStream(activeChatId);

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
