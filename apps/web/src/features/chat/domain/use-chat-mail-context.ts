import { MAX_CHAT_CONTEXT_MESSAGES } from "@quieter/ai/chat-context";
import type { ChatMailContext } from "@quieter/ai/chat-context";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getThreadWithDetailsOptions } from "#/lib/mail/thread-query";

import type { ChatContextItem } from "../components/chat-composer";
import type { ChatViewProps } from "../types";

export const useChatMailContext = (
  mailboxId: string,
  mailContext: ChatViewProps["mailContext"]
) => {
  const [attached, setAttached] = useState<ChatContextItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const { data: thread } = useQuery(
    getThreadWithDetailsOptions(
      mailboxId,
      mailContext?.threadId ?? "",
      !!mailContext?.threadId
    )
  );
  const selected =
    thread?.messages.find((message) => message.id === mailContext?.messageId) ??
    thread?.messages.at(-1);
  const automatic: ChatContextItem[] = [];
  if (
    (mailContext?.messageId || mailContext?.threadId) &&
    attached.length < MAX_CHAT_CONTEXT_MESSAGES
  ) {
    automatic.push({
      id: mailContext.messageId
        ? `mail:${mailContext.messageId}`
        : `thread:${mailContext.threadId}`,
      label: selected?.subject?.trim() || "Current conversation",
      messageId: mailContext.messageId,
      threadId: mailContext.threadId,
    });
  }
  if (mailContext?.query) {
    automatic.push({
      id: `search:${mailContext.query}`,
      label: `Search: ${mailContext.query}`,
      query: mailContext.query,
    });
  }
  const contextItems = [
    ...automatic.filter(
      (item) =>
        !dismissed.has(item.id) &&
        !attached.some((attachment) => attachment.id === item.id)
    ),
    ...attached,
  ];
  const selectedContext = contextItems.find(
    (item) =>
      automatic.some((candidate) => candidate.id === item.id) &&
      item.query === undefined
  );
  const attachedMessageIds = contextItems.flatMap((item) =>
    item.messageId ? [item.messageId] : []
  );
  const searchContext = contextItems.find((item) => item.query);
  const context: ChatMailContext = {
    messageIds: attachedMessageIds,
    ...(selectedContext?.threadId
      ? { threadId: selectedContext.threadId }
      : {}),
    ...(searchContext?.query ? { query: searchContext.query } : {}),
  };
  return {
    attachedMessageIds,
    context,
    contextItems,
    handleAttach: (item: ChatContextItem) => {
      if (
        attachedMessageIds.length < MAX_CHAT_CONTEXT_MESSAGES &&
        !contextItems.some((candidate) => candidate.id === item.id)
      ) {
        setAttached((current) => [...current, item]);
      }
    },
    handleRemove: (id: string) => {
      setDismissed((current) => new Set([...current, id]));
      setAttached((current) => current.filter((item) => item.id !== id));
    },
  };
};
