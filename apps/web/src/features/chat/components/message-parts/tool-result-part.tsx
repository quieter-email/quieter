import type { MessagePart } from "@tanstack/ai";
import { Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { formatMessageDate } from "../../domain/chat-formatting";
import { parseGmailSearchResult } from "../../domain/chat-tools";

export const ToolResultPart = ({
  part,
}: {
  part: Extract<MessagePart, { type: "tool-result" }>;
}) => {
  const result = parseGmailSearchResult(part.content);

  if (!result?.messages?.length) {
    if (result?.error) {
      return <p className="text-xs text-destructive">{result.error}</p>;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <HugeiconsIcon aria-hidden className="size-3.5 shrink-0" icon={Mail01Icon} />
        <span>
          {result.messages.length} result{result.messages.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-col gap-px">
        {result.messages.map((message) => (
          <div
            className="rounded-md px-3 py-2 transition-colors hover:bg-muted/40"
            key={message.id}
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                className={cn("min-w-0 flex-1 truncate text-xs", {
                  "font-medium text-foreground": message.isUnread,
                  "text-foreground/80": !message.isUnread,
                })}
              >
                {message.subject || "(no subject)"}
              </span>
              {message.date && (
                <span className="shrink-0 text-[11px] text-muted-foreground/60">
                  {formatMessageDate(message.date)}
                </span>
              )}
            </div>
            {message.from && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{message.from}</p>
            )}
            {message.snippet && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/50">
                {message.snippet}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
