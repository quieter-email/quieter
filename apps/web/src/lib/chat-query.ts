import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getChatsQueryKey = (mailboxId: string) => ["mailbox", mailboxId, "chats"] as const;
export const getChatQueryKey = (mailboxId: string, chatId: string | null) =>
  ["mailbox", mailboxId, "chat", chatId] as const;

const disabledChatsQueryKey = ["chats", "disabled"] as const;

export const chatsQueryOptions = (mailboxId: string | null) =>
  queryOptions({
    enabled: !!mailboxId,
    queryKey: mailboxId ? getChatsQueryKey(mailboxId) : disabledChatsQueryKey,
    queryFn: ({ signal }) => {
      if (!mailboxId) {
        throw new Error("Mailbox id is required.");
      }

      return rpc.chat.list({ mailboxId }, { signal });
    },
    refetchInterval: (query) =>
      query.state.data?.some((chat) => chat.isGenerating) ? 2_000 : false,
  });

export const chatQueryOptions = (mailboxId: string, chatId: string | null) =>
  queryOptions({
    enabled: !!chatId,
    queryKey: getChatQueryKey(mailboxId, chatId),
    queryFn: ({ signal }) => {
      if (!chatId) {
        throw new Error("Chat id is required.");
      }

      return rpc.chat.get({ chatId, mailboxId }, { signal });
    },
  });
