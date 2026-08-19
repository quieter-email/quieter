"use client";

import type { useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";

import { USER_BILLING_QUERY_KEY } from "#/features/settings/domain/billing";
import { getChatQueryKey, getChatsQueryKey } from "#/lib/chat-query";
import { orpc } from "#/lib/orpc";

import type {
  ChatQueryData,
  ChatsQueryData,
  ChatViewMutationSet,
} from "../lib/chat-view-helpers";

export const useChatViewMutations = ({
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
  const editUserMessageMutation = useMutation({
    ...orpc.chat.editUserMessage.mutationOptions(),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getChatQueryKey(mailboxId, variables.chatId),
      });
    },
  });
  const regenerateResponseMutation = useMutation({
    ...orpc.chat.regenerateResponse.mutationOptions(),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getChatQueryKey(mailboxId, variables.chatId),
      });
    },
  });
  const resolveComposeToolMutation = useMutation({
    ...orpc.chat.resolveComposeTool.mutationOptions(),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getChatQueryKey(mailboxId, variables.chatId),
      });
    },
  });
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
