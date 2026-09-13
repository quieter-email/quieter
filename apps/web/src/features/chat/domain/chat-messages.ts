import type { UIMessage } from "ai";

import { isChatToolPart } from "./chat-tools";

export const getMessageText = (parts: UIMessage["parts"]) =>
  parts
    .flatMap((part) =>
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim() !== ""
        ? [part.text.trim()]
        : []
    )
    .join("\n\n");

export const getAssistantProgress = (
  parts: UIMessage["parts"],
  isStreaming: boolean
) => {
  if (!isStreaming) {
    return null;
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "text") {
      if (typeof part.text === "string" && part.text.trim() !== "") {
        return null;
      }
      continue;
    }
    if (part !== undefined && isChatToolPart(part)) {
      return "Working with your mail…";
    }
  }

  return "Thinking…";
};
