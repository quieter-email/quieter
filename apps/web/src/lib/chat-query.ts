import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

export const getChatsQueryKey = (mailboxId: string) =>
  ["mailbox", mailboxId, "chats"] as const;
export const getChatQueryKey = (mailboxId: string, chatId: string | null) =>
  ["mailbox", mailboxId, "chat", chatId] as const;

const disabledChatsQueryKey = ["chats", "disabled"] as const;

export const chatsQueryOptions = (mailboxId: string | null) =>
  queryOptions({
    enabled: hasText(mailboxId),
    queryFn: async ({ signal }) => {
      if (!hasText(mailboxId)) {
        throw new Error("Mailbox id is required.");
      }

      return await rpc.chat.list({ mailboxId }, { signal });
    },
    queryKey: hasText(mailboxId)
      ? getChatsQueryKey(mailboxId)
      : disabledChatsQueryKey,
  });

export const chatQueryOptions = (mailboxId: string, chatId: string | null) =>
  queryOptions({
    enabled: hasText(chatId),
    queryFn: async ({ signal }) => {
      if (!hasText(chatId)) {
        throw new Error("Chat id is required.");
      }

      return await rpc.chat.get({ chatId, mailboxId }, { signal });
    },
    queryKey: getChatQueryKey(mailboxId, chatId),
  });
