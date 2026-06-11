import type { MessagePart } from "@tanstack/ai";

export const getCopyableMessageText = (parts: MessagePart[]) =>
  parts
    .flatMap((part) =>
      part.type === "text" && typeof part.content === "string" && part.content.trim()
        ? [part.content.trim()]
        : [],
    )
    .join("\n\n");
