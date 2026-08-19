"use client";

import type { ChatModel } from "@quieter/ai/chat-models";
import type { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";

import { getChatQueryKey, getChatsQueryKey } from "#/lib/chat-query";

import {
  beginChatRunStream,
  chatRunStore,
  commitChatRunStream,
  failChatRunStream,
  setChatPendingPrompt,
  updateChatRunDraft,
} from "../chat-run-store";
import type { ChatStreamingAssistant } from "../chat-run-store";
import type {
  ActiveChatRun,
  ChatQueryData,
  ChatsQueryData,
  ChatRunStartResult,
  StoredChatMessage,
} from "../lib/chat-view-helpers";
import { hasText, isActiveRun } from "../lib/chat-view-helpers";
import { useChatRunStream } from "./use-chat-run-stream";
import type { ChatRunStreamDone } from "./use-chat-run-stream";

const getLiveRunState = ({
  activeRun,
  chatData,
  chatId,
  mailboxId,
  locallyFailedChatId,
  locallyFailedMailboxId,
  streamChatId,
  streamMailboxId,
  streamRunId,
  streamingAssistant,
}: {
  activeRun: ActiveChatRun | null;
  chatData: ChatQueryData | undefined;
  chatId: string | null;
  mailboxId: string | null;
  locallyFailedChatId: string | null;
  locallyFailedMailboxId: string | null;
  streamChatId: string | null;
  streamMailboxId: string | null;
  streamRunId: string | null;
  streamingAssistant: ChatStreamingAssistant | null;
}) => {
  // A stream is only live for the chat being viewed; a leftover stream from another chat
  // (navigation) or another mailbox must not reconnect here. Once the stream gives up it is
  // marked failed so the server-side active run is not re-imported and reconnected on every focus.
  const isFailedForThisChat =
    locallyFailedChatId === chatId && locallyFailedMailboxId === mailboxId;
  const hasLiveStream =
    streamChatId === chatId &&
    streamMailboxId === mailboxId &&
    !isFailedForThisChat;
  const canResumeServerRun = !isFailedForThisChat && isActiveRun(activeRun);

  if (hasLiveStream) {
    return {
      liveAssistantMessageId: streamingAssistant?.messageId ?? null,
      liveAssistantParts: streamingAssistant?.parts,
      liveRunId: streamRunId,
    };
  }

  if (!canResumeServerRun) {
    return {
      liveAssistantMessageId: null,
      liveAssistantParts: undefined,
      liveRunId: null,
    };
  }

  const liveAssistantMessageId = activeRun?.assistantMessageId ?? null;
  const liveAssistantParts = hasText(liveAssistantMessageId)
    ? chatData?.messages.find(
        (message) => message.id === liveAssistantMessageId
      )?.parts
    : undefined;

  return {
    liveAssistantMessageId,
    liveAssistantParts,
    liveRunId: activeRun?.id ?? null,
  };
};

const applyChatRunStreamResult = ({
  chatId,
  mailboxId,
  queryClient,
  resolvedChatId,
  result,
}: {
  chatId: string | null;
  mailboxId: string;
  queryClient: ReturnType<typeof useQueryClient>;
  resolvedChatId?: string | null;
  result: ChatRunStreamDone;
}) => {
  const targetChatId = resolvedChatId ?? chatId;

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
};

const handleChatRunStreamFailure = ({
  chatId,
  liveAssistantMessageId,
  liveAssistantParts,
  mailboxId,
  message,
  queryClient,
  streamChatId,
  streamMailboxId,
}: {
  chatId: string | null;
  liveAssistantMessageId: string | null;
  liveAssistantParts: ChatStreamingAssistant["parts"] | undefined;
  mailboxId: string;
  message: string;
  queryClient: ReturnType<typeof useQueryClient>;
  streamChatId: string | null;
  streamMailboxId: string | null;
}) => {
  // One persistent surface: write the failure into the cached message so the inline
  // ChatError banner shows it, mark the run locally failed so it is not reconnected,
  // then refresh. No toast - a reconnect storm must not spam notifications.
  const resolvedChatId = streamChatId ?? chatId;
  const resolvedMailboxId = streamMailboxId ?? mailboxId;
  const failedMessageId = liveAssistantMessageId ?? "";

  if (!hasText(resolvedChatId) || !hasText(resolvedMailboxId)) {
    failChatRunStream({
      chatId: resolvedChatId ?? "",
      mailboxId: resolvedMailboxId,
    });
    return;
  }

  applyChatRunStreamResult({
    chatId,
    mailboxId,
    queryClient,
    resolvedChatId,
    result: {
      assistantMessageId: failedMessageId,
      error: message,
      parts: liveAssistantParts ?? [],
      status: "failed",
    },
  });
  failChatRunStream({ chatId: resolvedChatId, mailboxId: resolvedMailboxId });
  void queryClient.invalidateQueries({
    queryKey: getChatQueryKey(mailboxId, resolvedChatId),
  });
};

export const useChatViewStream = ({
  chatData,
  chatId,
  mailboxId,
  model,
  queryClient,
}: {
  chatData: ChatQueryData | undefined;
  chatId: string | null;
  mailboxId: string;
  model: ChatModel;
  queryClient: ReturnType<typeof useQueryClient>;
}) => {
  const activeRun = chatData?.activeRun ?? null;
  const {
    locallyFailedChatId,
    locallyFailedMailboxId,
    streamChatId,
    streamMailboxId,
    streamRunId,
    streamingAssistant,
  } = useSelector(chatRunStore, (state) => state);

  const beginAssistantStream = (result: ChatRunStartResult) => {
    const queryKey = getChatQueryKey(mailboxId, result.chatId);

    const now = new Date();
    // A chat created by this submit has no cached entry yet. Seeding one paints the turn
    // immediately instead of waiting for the invalidating refetch to land.
    const seeded: ChatQueryData = {
      activeRun: result.activeRun,
      createdAt: now,
      id: result.chatId,
      lastModel: model,
      messages: result.messages,
      title: null,
      updatedAt: now,
    };

    queryClient.setQueryData<ChatQueryData>(queryKey, (current) =>
      current
        ? {
            ...current,
            activeRun: result.activeRun,
            messages: result.messages,
          }
        : seeded
    );

    if (!isActiveRun(result.activeRun)) {
      // The run already reached a terminal status. Keep the persisted parts instead of
      // blanking the message behind a "Thinking" placeholder that will never resolve.
      commitChatRunStream(result.chatId);
      setChatPendingPrompt(null);
      return;
    }

    beginChatRunStream({
      assistantMessageId: result.assistantMessageId,
      chatId: result.chatId,
      mailboxId,
      // Seed from the stored draft so a resumed run keeps what it has already written.
      parts: result.messages.find(
        (message) => message.id === result.assistantMessageId
      )?.parts ?? [{ content: "", type: "text" }],
      runId: result.runId,
    });
  };

  const { liveAssistantMessageId, liveAssistantParts, liveRunId } =
    getLiveRunState({
      activeRun,
      chatData,
      chatId,
      locallyFailedChatId,
      locallyFailedMailboxId,
      mailboxId,
      streamChatId,
      streamMailboxId,
      streamRunId,
      streamingAssistant,
    });

  const commitStreamResult = (
    result: ChatRunStreamDone,
    resolvedChatId?: string | null
  ) => {
    applyChatRunStreamResult({
      chatId,
      mailboxId,
      queryClient,
      resolvedChatId,
      result,
    });
  };

  useChatRunStream({
    assistantMessageId: liveAssistantMessageId,
    enabled: hasText(liveRunId) && hasText(liveAssistantMessageId),
    initialParts: liveAssistantParts,
    onDone: (result) => {
      commitStreamResult(result, streamChatId);
      const resolvedChatId = streamChatId ?? chatId;
      if (hasText(resolvedChatId)) {
        commitChatRunStream(resolvedChatId);
      }
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
      updateChatRunDraft({ messageId: assistantMessageId, parts });
    },
    onError: (message) => {
      handleChatRunStreamFailure({
        chatId,
        liveAssistantMessageId,
        liveAssistantParts,
        mailboxId,
        message,
        queryClient,
        streamChatId,
        streamMailboxId,
      });
    },
    runId: liveRunId,
  });

  return {
    activeRun,
    beginAssistantStream,
    commitStreamResult,
    liveRunId,
  };
};

export {
  applyChatRunStreamResult,
  getLiveRunState,
  handleChatRunStreamFailure,
};
