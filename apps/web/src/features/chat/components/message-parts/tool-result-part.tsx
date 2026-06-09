import type { MessagePart } from "@tanstack/ai";
import { Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { m } from "motion/react";
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
    <m.div
      animate={{ opacity: 1 }}
      className="flex flex-col gap-1 py-0.5"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <HugeiconsIcon aria-hidden className="size-3 shrink-0" icon={Mail01Icon} />
        <span>
          {result.messages.length} result{result.messages.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {result.messages.map((message) => (
          <div
            className="rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted"
            key={message.id}
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                className={cn("min-w-0 flex-1 truncate text-xs", {
                  "font-medium text-foreground": message.isUnread,
                  "text-foreground/90": !message.isUnread,
                })}
              >
                {message.subject || "(no subject)"}
              </span>
              {message.date && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatMessageDate(message.date)}
                </span>
              )}
            </div>
            {message.from && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{message.from}</p>
            )}
            {message.snippet && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                {message.snippet}
              </p>
            )}
          </div>
        ))}
      </div>
    </m.div>
  );
};
