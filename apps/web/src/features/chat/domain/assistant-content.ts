import type { ChatMessagePart } from "@quieter/orpc/chat-contracts";
import type { MessagePart } from "@tanstack/ai";

/**
 * The tool call the model is on right now: the last one written, with nothing said
 * after it. Once the model writes text or starts another step this returns something
 * else, which is what folds a finished step's result back away.
 */
export const getActiveToolCallId = (parts: MessagePart[]): string | null => {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];

    if (part.type === "tool-result") {
      return part.toolCallId;
    }
    if (part.type === "tool-call") {
      return part.id;
    }
    if (
      (part.type === "text" || part.type === "thinking") &&
      part.content.trim() !== ""
    ) {
      return null;
    }
  }

  return null;
};

export const hasVisibleAssistantContent = (
  parts: (ChatMessagePart | MessagePart)[]
) =>
  parts.some((part) => {
    if (part.type === "tool-call" || part.type === "tool-result") {
      return true;
    }

    if (part.type === "text" || part.type === "thinking") {
      return typeof part.content === "string" && part.content.trim().length > 0;
    }

    return false;
  });
