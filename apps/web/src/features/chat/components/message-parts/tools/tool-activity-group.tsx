"use client";

import type { MessagePart } from "@tanstack/ai";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import type { ResolveComposeTool } from "../../../types";
import { getActiveToolDetail, summarizeToolCalls } from "../../../domain/tool-summaries";
import { ToolPart } from "../tool-part";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

type ToolActivityGroupProps = {
  actionsDisabled?: boolean;
  assistantMessageId: string;
  isStreaming?: boolean;
  items: Array<{ call: ToolCall; result?: ToolResult }>;
  onResolveCompose: ResolveComposeTool;
};

export const ToolActivityGroup = ({
  actionsDisabled,
  assistantMessageId,
  isStreaming = false,
  items,
  onResolveCompose,
}: ToolActivityGroupProps) => {
  const hasPending = items.some((item) => !item.result);
  const [expanded, setExpanded] = useState(hasPending);
  const [previousHasPending, setPreviousHasPending] = useState(hasPending);
  if (previousHasPending !== hasPending) {
    setPreviousHasPending(hasPending);
    if (!hasPending) setExpanded(false);
  }
  const summaryItems = items.map((item) => ({
    call: item.call,
    pending: !item.result,
    result: item.result,
  }));
  const summary = summarizeToolCalls(summaryItems);
  const activeDetail = hasPending
    ? getActiveToolDetail(
        items.find((item) => !item.result)?.call ?? items[items.length - 1]!.call,
        items.find((item) => !item.result)?.result,
      )
    : undefined;

  if (items.length === 1) {
    const item = items[0]!;
    return (
      <ToolPart
        actionsDisabled={actionsDisabled}
        assistantMessageId={assistantMessageId}
        call={item.call}
        onResolveCompose={onResolveCompose}
        result={item.result}
      />
    );
  }

  return (
    <div className="py-1">
      <button
        aria-expanded={expanded}
        className="group flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {hasPending && isStreaming ? (
          <span className="inline-flex gap-0.5">
            <span className="size-1 animate-pulse rounded-full bg-muted-foreground/55 [animation-delay:0ms]" />
            <span className="size-1 animate-pulse rounded-full bg-muted-foreground/55 [animation-delay:150ms]" />
            <span className="size-1 animate-pulse rounded-full bg-muted-foreground/55 [animation-delay:300ms]" />
          </span>
        ) : (
          <HugeiconsIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/45 transition-transform duration-200",
              { "rotate-90": expanded },
            )}
            icon={ArrowRight01Icon}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm/relaxed text-muted-foreground">
          <span className="capitalize">{summary}</span>
          {activeDetail ? (
            <span className="ml-2 text-muted-foreground/70">{activeDetail}</span>
          ) : null}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="mt-1.5 space-y-0.5 border-l border-border/60 pl-3">
              {items.map((item) => (
                <ToolPart
                  actionsDisabled={actionsDisabled}
                  assistantMessageId={assistantMessageId}
                  call={item.call}
                  key={item.call.id}
                  nested
                  onResolveCompose={onResolveCompose}
                  result={item.result}
                />
              ))}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
