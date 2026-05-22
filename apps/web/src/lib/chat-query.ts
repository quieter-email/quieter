import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getChatsQueryKey = () => ["chats"] as const;
export const getChatQueryKey = (chatId: string | null) => ["chat", chatId] as const;

export const chatsQueryOptions = () =>
  queryOptions({
    queryKey: getChatsQueryKey(),
    queryFn: ({ signal }) => rpc.chat.list(undefined, { signal }),
  });

export const chatQueryOptions = (chatId: string | null) =>
  queryOptions({
    enabled: !!chatId,
    queryKey: getChatQueryKey(chatId),
    queryFn: ({ signal }) => {
      if (!chatId) {
        throw new Error("Chat id is required.");
      }

      return rpc.chat.get({ chatId }, { signal });
    },
  });
