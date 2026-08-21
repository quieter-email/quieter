import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "ai";

type StoredMessage = RouterOutputs["chat"]["get"]["messages"][number];

/**
 * Persisted rows already store native UI message parts, so loading history is
 * a straight projection; unknown part types are ignored by the renderer.
 */
export const toInitialMessages = (messages: StoredMessage[]): UIMessage[] =>
  messages.flatMap((message) => {
    if (message.role !== "assistant" && message.role !== "user") {
      return [];
    }
    return [
      {
        id: message.id,
        // Parts round-trip as opaque JSON; the renderer switches on known
        // part types only.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        parts: message.parts as UIMessage["parts"],
        role: message.role,
      },
    ];
  });

export const getMessageText = (parts: UIMessage["parts"]) =>
  parts
    .flatMap((part) =>
      part.type === "text" && part.text.trim() ? [part.text.trim()] : []
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
      if (part.text.trim()) {
        return null;
      }
      continue;
    }
    if (typeof part?.type === "string" && part.type.startsWith("tool-")) {
      return "Working with your mail…";
    }
  }

  return "Thinking…";
};
