import type { MessagePart } from "@tanstack/ai";
import { m } from "motion/react";
import { parseToolArguments } from "../../domain/chat-tools";

const toolLabel = (name: string) => {
  if (name === "search_gmail") return "Searched";
  return name;
};

export const ToolCallPart = ({ part }: { part: Extract<MessagePart, { type: "tool-call" }> }) => {
  const args = parseToolArguments(part.arguments);
  const query = typeof args.query === "string" ? args.query : null;
  const isActive = part.state === "input-streaming" || part.state === "input-complete";

  return (
    <m.p
      animate={{ opacity: 1 }}
      className="text-xs text-muted-foreground"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {isActive ? "Searching" : toolLabel(part.name)}
      {query ? ` "${query}"` : ""}
    </m.p>
  );
};
