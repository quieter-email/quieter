import type { MessagePart } from "@tanstack/ai";
import { Loading03Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { formatToolState, parseToolArguments } from "../../domain/chat-tools";

export const ToolCallPart = ({ part }: { part: Extract<MessagePart, { type: "tool-call" }> }) => {
  const args = parseToolArguments(part.arguments);
  const query = typeof args.query === "string" ? args.query : null;
  const isActive = part.state === "input-streaming" || part.state === "input-complete";

  return (
    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <HugeiconsIcon
        aria-hidden
        className={cn("size-3.5 shrink-0", { "animate-spin": isActive })}
        icon={part.name === "search_gmail" ? Search01Icon : Loading03Icon}
      />
      <span className="truncate">
        {part.name === "search_gmail" ? "Searching" : part.name}
        {query ? ` - ${query}` : ""}
      </span>
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50">
        {formatToolState(part.state)}
      </span>
    </div>
  );
};
