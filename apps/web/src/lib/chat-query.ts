import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getChatsQueryKey = (mailboxId: string | null) =>
  ["mailbox", mailboxId, "chats"] as const;
export const getChatQueryKey = (mailboxId: string | null, chatId: string | null) =>
  ["mailbox", mailboxId, "chat", chatId] as const;

export const chatsQueryOptions = (mailboxId: string | null) =>
  queryOptions({
    queryKey: getChatsQueryKey(mailboxId),
    queryFn: ({ signal }) => rpc.chat.list(undefined, { signal }),
  });

export const chatQueryOptions = (mailboxId: string | null, chatId: string | null) =>
  queryOptions({
    enabled: !!chatId,
    queryKey: getChatQueryKey(mailboxId, chatId),
    queryFn: ({ signal }) => {
      if (!chatId) {
        throw new Error("Chat id is required.");
      }

      return rpc.chat.get({ chatId }, { signal });
    },
  });
