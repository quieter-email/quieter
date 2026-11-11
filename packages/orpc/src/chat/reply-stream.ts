import { isForegroundClientToolName } from "@quieter/ai/chat-tools";
import type { TextStreamPart, ToolSet } from "ai";

export const completeChatReply = <TOOLS extends ToolSet>() => {
  const pending = new Set<string>();
  let hasReply = false;
  let interrupted = false;

  return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
    transform(part, controller) {
      if (part.type === "text-delta") {
        hasReply ||= part.text.trim() !== "";
      } else if (
        part.type === "tool-call" &&
        part.invalid !== true &&
        isForegroundClientToolName(part.toolName)
      ) {
        pending.add(part.toolCallId);
      } else if (
        part.type === "tool-approval-request" &&
        part.isAutomatic !== true
      ) {
        pending.add(part.toolCall.toolCallId);
      } else if (
        (part.type === "tool-result" && part.preliminary !== true) ||
        part.type === "tool-error" ||
        part.type === "tool-output-denied"
      ) {
        pending.delete(part.toolCallId);
        if (part.toolName !== "suggest_replies") {
          hasReply = false;
        }
      } else if (part.type === "error" || part.type === "abort") {
        interrupted = true;
      } else if (
        part.type === "finish" &&
        !hasReply &&
        !interrupted &&
        pending.size === 0 &&
        part.finishReason !== "error"
      ) {
        const id = crypto.randomUUID();
        controller.enqueue({ id, type: "text-start" });
        controller.enqueue({
          id,
          text: "I couldn't finish this reply. You can ask me to continue.",
          type: "text-delta",
        });
        controller.enqueue({ id, type: "text-end" });
      }
      controller.enqueue(part);
    },
  });
};
