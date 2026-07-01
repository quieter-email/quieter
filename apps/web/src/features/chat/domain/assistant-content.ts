import type { ChatMessagePart } from "@quieter/database/schema";
import type { MessagePart } from "@tanstack/ai";

export const hasVisibleAssistantContent = (parts: Array<ChatMessagePart | MessagePart>) =>
  parts.some((part) => {
    if (part.type === "tool-call" || part.type === "tool-result") {
      return true;
    }

    if (part.type === "text" || part.type === "thinking") {
      return typeof part.content === "string" && part.content.trim().length > 0;
    }

    return false;
  });
