import type { TextStreamPart, ToolSet } from "ai";

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
