import { isToolUIPart } from "ai";
import type { FinishReason, TextStreamPart, ToolSet, UIMessage } from "ai";

export const chatReplyInterruption = (
  parts: UIMessage["parts"],
  finishReason: FinishReason | undefined
): string | null => {
  if (finishReason === "length") {
    return "The reply reached its length limit before it finished.";
  }
  if (finishReason === "content-filter") {
    return "The reply was stopped before it finished.";
  }
  if (finishReason !== "stop" && finishReason !== "tool-calls") {
    return "The reply was interrupted.";
  }
  const finalStep = parts.slice(
    parts.findLastIndex((part) => part.type === "step-start") + 1
  );
  const lastResult = parts.findLast(
    (part) =>
      (isToolUIPart(part) && part.type !== "tool-suggest_replies") ||
      (part.type === "text" && part.text.trim() !== "")
  );
  if (finalStep.some(isToolUIPart) || lastResult?.type === "text") {
    return null;
  }
  return "The assistant stopped before finishing this reply.";
};

export const filterChatToolInputDrafts = <TOOLS extends ToolSet>() =>
  new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
    transform(part, controller) {
      if (
        part.type !== "tool-input-start" &&
        part.type !== "tool-input-delta" &&
        part.type !== "tool-input-end"
      ) {
        controller.enqueue(part);
      }
    },
  });
