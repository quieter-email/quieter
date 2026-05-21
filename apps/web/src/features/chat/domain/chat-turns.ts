import type { UIMessage } from "@tanstack/ai";
import type { ChatTurn } from "../types";

export const createChatTurns = (messages: UIMessage[]): ChatTurn[] => {
  const turns: ChatTurn[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;

    if (message.role === "user") {
      const next = messages[i + 1];
      turns.push({
        assistant: next?.role === "assistant" ? next : null,
        id: message.id,
        user: message,
      });

      if (next?.role === "assistant") {
        i++;
      }
      continue;
    }

    if (message.role === "assistant") {
      turns.push({ assistant: message, id: message.id, user: null });
    }
  }

  return turns;
};
