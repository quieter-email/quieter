import type { MessagePart } from "@tanstack/ai";
import { TextPart } from "./text-part";
import { ThinkingPart } from "./thinking-part";
import { ToolCallPart } from "./tool-call-part";
import { ToolResultPart } from "./tool-result-part";

const getLastThinkingIndex = (parts: MessagePart[]) =>
  parts.reduce<number>((last, part, index) => (part.type === "thinking" ? index : last), -1);

const getPartKey = (part: MessagePart, index: number) => {
  if (part.type === "text" || part.type === "thinking") {
    const partId = "id" in part && typeof part.id === "string" ? part.id : index;
    return `${part.type}:${partId}`;
  }

  if (part.type === "tool-call") return `tool-call:${part.id}`;
  if (part.type === "tool-result") return `tool-result:${part.toolCallId}`;
  return part.type;
};

export const AssistantParts = ({
  isStreaming = false,
  parts,
}: {
  isStreaming?: boolean;
  parts: MessagePart[];
}) => {
  const lastThinkingIndex = getLastThinkingIndex(parts);

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "text") {
          if (!part.content.trim()) {
            return null;
          }

          return <TextPart key={getPartKey(part, index)} text={part.content} />;
        }

        if (part.type === "thinking") {
          const isActive = isStreaming && index === lastThinkingIndex;
          if (!part.content.trim() && !isActive) {
            return null;
          }

          return (
            <ThinkingPart
              content={part.content}
              isActive={isActive}
              key={getPartKey(part, index)}
            />
          );
        }

        if (part.type === "tool-call") {
          return <ToolCallPart key={part.id} part={part} />;
        }

        if (part.type === "tool-result") {
          return <ToolResultPart key={part.toolCallId} part={part} />;
        }

        return null;
      })}
    </>
  );
};
