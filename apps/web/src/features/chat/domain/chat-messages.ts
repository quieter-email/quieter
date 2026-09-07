import type { RouterOutputs } from "@quieter/orpc";
import type { UIMessage } from "ai";

import { isChatToolPart } from "./chat-tools";

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
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim() !== ""
        ? [part.text.trim()]
        : []
    )
    .join("\n\n");

export const getChatRetryAction = (
  localMessages: UIMessage[],
  persistedMessages: UIMessage[]
):
  | { messageId: string; text: string; type: "resubmit-user" }
  | { type: "hydrate" | "regenerate" | "unavailable" } => {
  const localUserMessage = localMessages.findLast(
    (message) => message.role === "user"
  );
  if (
    localUserMessage !== undefined &&
    !persistedMessages.some((message) => message.id === localUserMessage.id)
  ) {
    const text = getMessageText(localUserMessage.parts);
    return text === ""
      ? { type: "unavailable" }
      : {
          messageId: localUserMessage.id,
          text,
          type: "resubmit-user",
        };
  }

  const localLastMessage = localMessages.at(-1);
  const persistedLastMessage = persistedMessages.at(-1);
  if (!persistedMessages.some((message) => message.role === "user")) {
    return { type: "unavailable" };
  }
  if (
    persistedLastMessage?.role !== "assistant" ||
    (localLastMessage?.role === "assistant" &&
      localLastMessage.id !== persistedLastMessage.id)
  ) {
    return { type: "regenerate" };
  }
  return { type: "hydrate" };
};

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
