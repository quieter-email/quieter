import type { UIMessage } from "ai";

type ChatMessagePart = { type: string; [key: string]: unknown };

const isRenderablePart = (part: ChatMessagePart): boolean => {
  if (part.type === "text") {
    return typeof part.text === "string";
  }
  if (part.type === "") {
    return false;
  }
  if (part.type === "step-start") {
    return true;
  }
  return part.type.startsWith("tool-") && typeof part.toolCallId === "string";
};

/**
 * Maps persisted message rows onto AI SDK UI messages. Parts are stored in
 * their native UI message shape, so this only drops malformed entries.
 */
export const toCanonicalTranscript = (
  messages: readonly {
    id: string;
    parts: ChatMessagePart[];
    role: "assistant" | "system" | "user";
  }[]
): UIMessage[] =>
  messages.flatMap((message) => {
    if (message.role !== "assistant" && message.role !== "user") {
      return [];
    }
    const parts = message.parts.filter(isRenderablePart).map((part) =>
      part.state === "approval-responded"
        ? {
            ...part,
            errorText:
              "The action was submitted, but its result is not available. Check the affected item before requesting it again.",
            state: "output-error",
          }
        : part
    );
    if (parts.length === 0) {
      return [];
    }
    return [
      {
        id: message.id,
        // Parts round-trip as opaque JSON; convertToModelMessages validates
        // the shapes it consumes.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        parts: parts as UIMessage["parts"],
        role: message.role,
      } satisfies UIMessage,
    ];
  });
