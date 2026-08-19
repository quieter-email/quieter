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
export type ChatPendingPrompt = {
  chatKey: string;
  mailboxId: string;
  text: string;
};
export type ChatStreamingAssistant = {
  messageId: string;
  parts: ChatMessagePart[];
};

export type ChatRunState = {
  /** Locally painted turn standing in until the run record exists. */
  pendingPrompt: ChatPendingPrompt | null;
  /** Id of the active SSE stream, scoped to `streamChatId` + `streamMailboxId`. */
  streamRunId: string | null;
  /** Live assistant draft merged over the cached message while streaming. */
  streamingAssistant: ChatStreamingAssistant | null;
  /** Chat the active stream belongs to; null when no stream is running. */
  streamChatId: string | null;
  /** Mailbox the active stream belongs to — disambiguates `draftChatKey` collisions. */
  streamMailboxId: string | null;
  /**
   * Set when the stream gives up so the client stops reconnecting a run that is still
   * reported active server-side instead of erroring repeatedly on every reconnect.
   */
  locallyFailedChatId: string | null;
  /** Mailbox for the locally-failed run — paired with `locallyFailedChatId`. */
  locallyFailedMailboxId: string | null;
};

export const chatRunStore = createStore<ChatRunState>({
  locallyFailedChatId: null,
  locallyFailedMailboxId: null,
  pendingPrompt: null,
  streamChatId: null,
  streamMailboxId: null,
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
  mailboxId,
  parts,
  runId,
}: {
  assistantMessageId: string;
  chatId: string;
  mailboxId: string;
  parts: ChatMessagePart[];
  runId: string;
}) => {
  chatRunStore.setState((state) => ({
    ...state,
    locallyFailedChatId: null,
    locallyFailedMailboxId: null,
    pendingPrompt: null,
    streamChatId: chatId,
    streamMailboxId: mailboxId,
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
          locallyFailedMailboxId: null,
          streamChatId: null,
          streamMailboxId: null,
          streamRunId: null,
          streamingAssistant: null,
        }
      : state
  );
};

export const failChatRunStream = (input: {
  chatId: string;
  mailboxId?: string | null;
}) => {
  chatRunStore.setState((state) => ({
    ...state,
    locallyFailedChatId: input.chatId,
    locallyFailedMailboxId:
      input.mailboxId ?? state.streamMailboxId ?? state.locallyFailedMailboxId,
    streamChatId: null,
    streamMailboxId: null,
    streamRunId: null,
    streamingAssistant: null,
  }));
};

export const clearChatRunStoreForMailbox = (mailboxId: string) => {
  chatRunStore.setState((state) => {
    const hasPendingForMailbox = state.pendingPrompt?.mailboxId === mailboxId;
    const streamForMailbox = state.streamMailboxId === mailboxId;
    const failedForMailbox = state.locallyFailedMailboxId === mailboxId;

    if (!hasPendingForMailbox && !streamForMailbox && !failedForMailbox) {
      return state;
    }

    return {
      ...state,
      locallyFailedChatId: failedForMailbox ? null : state.locallyFailedChatId,
      locallyFailedMailboxId: failedForMailbox
        ? null
        : state.locallyFailedMailboxId,
      pendingPrompt: hasPendingForMailbox ? null : state.pendingPrompt,
      streamChatId: streamForMailbox ? null : state.streamChatId,
      streamMailboxId: streamForMailbox ? null : state.streamMailboxId,
      streamRunId: streamForMailbox ? null : state.streamRunId,
      streamingAssistant: streamForMailbox ? null : state.streamingAssistant,
    };
  });
};

/**
 * Pure helper: does the store currently hold a live or locally-failed run for this mailbox+chat?
 * Avoids direct `chatRunStore.state` reads in render paths — pass `useSelector` state instead
 * when inside a component, or call with `chatRunStore.state` in non-reactive contexts like
 * `refetchOnWindowFocus`.
 */
export const isChatRunActiveLocallyForState = (
  chatId: string | null,
  mailboxId: string | null,
  state: ChatRunState
) => {
  if (
    chatId === null ||
    chatId === "" ||
    mailboxId === null ||
    mailboxId === ""
  ) {
    return false;
  }
  const activeForMailboxAndChat =
    state.streamChatId === chatId &&
    state.streamMailboxId === mailboxId &&
    state.streamRunId !== null;
  const failedForMailboxAndChat =
    state.locallyFailedChatId === chatId &&
    state.locallyFailedMailboxId === mailboxId;
  return activeForMailboxAndChat || failedForMailboxAndChat;
};

/** Non-reactive convenience — reads `chatRunStore.state` directly. Use only outside renders. */
export const isChatRunActiveLocally = (
  chatId: string | null,
  mailboxId: string | null
) => isChatRunActiveLocallyForState(chatId, mailboxId, chatRunStore.state);
