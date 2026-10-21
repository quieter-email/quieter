import { isChatToolPart } from "@quieter/app/features/chat/domain/chat-tools";
import type { UIMessage } from "ai";
import { z } from "zod";

const chatSuggestionsSchema = z.object({
  status: z.literal("success"),
  suggestions: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        text: z.string().trim().min(1).max(300),
      })
    )
    .min(1)
    .max(3),
});

export const getMessageSuggestions = (parts: UIMessage["parts"]) => {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (
      part?.type !== "tool-suggest_replies" ||
      !("state" in part) ||
      part.state !== "output-available" ||
      !("output" in part)
    ) {
      continue;
    }
    const result = chatSuggestionsSchema.safeParse(part.output);
    if (result.success) {
      return result.data.suggestions.filter(
        (suggestion, suggestionIndex, suggestions) =>
          suggestions.findIndex((item) => item.text === suggestion.text) ===
          suggestionIndex
      );
    }
  }
  return [];
};

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
