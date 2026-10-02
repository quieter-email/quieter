import { isForegroundClientToolName } from "@quieter/ai/chat-tools";
import { isToolUIPart } from "ai";
import type { UIMessage } from "ai";

export const needsForegroundContinuation = (messages: UIMessage[]) => {
  const message = messages.at(-1);
  if (message?.role !== "assistant") {
    return false;
  }
  const start = message.parts.findLastIndex(
    (part) => part.type === "step-start"
  );
  const tools = message.parts.slice(start + 1).filter(isToolUIPart);
  return (
    tools.length > 0 &&
    tools.every(
      (part) =>
        part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "approval-responded"
    ) &&
    tools.some(
      (part) =>
        part.state === "approval-responded" ||
        isForegroundClientToolName(part.type.replace("tool-", ""))
    )
  );
};

export const cancelForegroundMessages = (messages: UIMessage[]): UIMessage[] =>
  messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      isToolUIPart(part) &&
      part.state !== "output-available" &&
      part.state !== "output-error" &&
      part.state !== "output-denied"
        ? {
            ...part,
            approval: undefined,
            errorText:
              "Stopped. Check the affected item before requesting the action again.",
            input: part.input,
            state: "output-error" as const,
          }
        : part
    ),
  }));
