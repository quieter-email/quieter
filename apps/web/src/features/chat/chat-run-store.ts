"use client";

import type { ChatMessagePart } from "@quieter/orpc/chat-contracts";
import { createStore } from "@tanstack/react-store";

/**
 * Transient streaming state for the chat run that owns the live response.
 *
 * This lives in a module-level store (not component state) because the chat view is
 * remounted when a fresh chat is created (`mailbox-workspace-content` keys the chat
 * panel by chatId), and the optimistic pending turn plus the active SSE run must
 * survive that remount.
 */
export type ChatPendingPrompt = { chatKey: string; text: string };
export type ChatStreamingAssistant = {
  messageId: string;
  parts: ChatMessagePart[];
};

export type ChatRunState = {
  /** Locally painted turn standing in until the run record exists. */
  pendingPrompt: ChatPendingPrompt | null;
  /** Id of the active SSE stream, scoped to `streamChatId`. */
  streamRunId: string | null;
  /** Live assistant draft merged over the cached message while streaming. */
  streamingAssistant: ChatStreamingAssistant | null;
  /** Chat the active stream belongs to; null when no stream is running. */
  streamChatId: string | null;
  /**
   * Set when the stream gives up so the client stops reconnecting a run that is still
   * reported active server-side instead of erroring repeatedly on every reconnect.
   */
  locallyFailedChatId: string | null;
};

export const chatRunStore = createStore<ChatRunState>({
  locallyFailedChatId: null,
  pendingPrompt: null,
  streamChatId: null,
  streamRunId: null,
  streamingAssistant: null,
});

export const setChatPendingPrompt = (
  pendingPrompt: ChatPendingPrompt | null
) => {
  chatRunStore.setState((state) => ({ ...state, pendingPrompt }));
};

export const beginChatRunStream = ({
  assistantMessageId,
  chatId,
  parts,
  runId,
}: {
  assistantMessageId: string;
  chatId: string;
  parts: ChatMessagePart[];
  runId: string;
}) => {
  chatRunStore.setState((state) => ({
    ...state,
    locallyFailedChatId: null,
    pendingPrompt: null,
    streamChatId: chatId,
    streamRunId: runId,
    streamingAssistant: { messageId: assistantMessageId, parts },
  }));
};

export const updateChatRunDraft = ({
  messageId,
  parts,
}: {
  messageId: string;
  parts: ChatMessagePart[];
}) => {
  chatRunStore.setState((state) =>
    state.streamingAssistant === null ||
    state.streamingAssistant.messageId !== messageId
      ? state
      : { ...state, streamingAssistant: { messageId, parts } }
  );
};

export const commitChatRunStream = (chatId: string) => {
  chatRunStore.setState((state) =>
    state.streamChatId === chatId
      ? {
          ...state,
          locallyFailedChatId: null,
          streamChatId: null,
          streamRunId: null,
          streamingAssistant: null,
        }
      : state
  );
};

export const failChatRunStream = (chatId: string) => {
  chatRunStore.setState((state) => ({
    ...state,
    locallyFailedChatId: chatId,
    streamChatId: null,
    streamRunId: null,
    streamingAssistant: null,
  }));
};
