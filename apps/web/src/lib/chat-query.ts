import { queryOptions } from "@tanstack/react-query";

import { rpc } from "#/lib/orpc";

export const getChatsQueryKey = (mailboxId: string) =>
  ["mailbox", mailboxId, "chats"] as const;
export const getChatQueryKey = (mailboxId: string, chatId: string | null) =>
  ["mailbox", mailboxId, "chat", chatId] as const;

const disabledChatsQueryKey = ["chats", "disabled"] as const;

export const chatsQueryOptions = (mailboxId: string | null) =>
  queryOptions({
    enabled: !!mailboxId,
    queryFn: async ({ signal }) => {
      if (!mailboxId) {
        throw new Error("Mailbox id is required.");
      }

      return await rpc.chat.list({ mailboxId }, { signal });
    },
    queryKey: mailboxId ? getChatsQueryKey(mailboxId) : disabledChatsQueryKey,
  });

export const chatQueryOptions = (mailboxId: string, chatId: string | null) =>
  queryOptions({
    enabled: !!chatId,
    queryFn: async ({ signal }) => {
      if (!chatId) {
        throw new Error("Chat id is required.");
      }

      return await rpc.chat.get({ chatId, mailboxId }, { signal });
    },
    queryKey: getChatQueryKey(mailboxId, chatId),
  });
