import type { MessagePart } from "@tanstack/ai";
import { FormattedText } from "./formatted-text";
import { InlineToolCall, InlineToolResult } from "./tool-parts";

export const UserParts = ({ parts }: { parts: MessagePart[] }) => (
  <>{parts.map((part, i) => (part.type === "text" ? <span key={i}>{part.content}</span> : null))}</>
);

export const AssistantParts = ({ parts }: { parts: MessagePart[] }) => (
  <>
    {parts.map((part, i) => {
      if (part.type === "text") {
        return <FormattedText key={i} text={part.content} />;
      }

      if (part.type === "thinking" && part.content.trim()) {
        return (
          <p className="text-xs leading-5 text-muted-foreground/60 italic" key={i}>
            {part.content}
          </p>
        );
      }

      if (part.type === "tool-call") {
        return <InlineToolCall key={part.id} part={part} />;
      }

      if (part.type === "tool-result") {
        return <InlineToolResult key={part.toolCallId} part={part} />;
      }

      return null;
    })}
  </>
);
