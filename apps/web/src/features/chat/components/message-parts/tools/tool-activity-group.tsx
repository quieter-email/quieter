"use client";

import type { MessagePart } from "@tanstack/ai";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";
import { getAppPresenceMotion } from "~/features/motion/app-motion";
import type { ResolveComposeTool } from "../../../types";
import { getActiveToolDetail, summarizeToolCalls } from "../../../domain/tool-summaries";
import { LoadingDots } from "../../thinking-indicator";
import { ToolPart } from "../tool-part";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

type ToolActivityGroupProps = {
  actionsDisabled?: boolean;
  animateEntrance?: boolean;
  assistantMessageId: string;
  isStreaming?: boolean;
  items: Array<{ call: ToolCall; result?: ToolResult }>;
  onResolveCompose: ResolveComposeTool;
};

export const ToolActivityGroup = ({
  actionsDisabled,
  animateEntrance = false,
  assistantMessageId,
  isStreaming = false,
  items,
  onResolveCompose,
}: ToolActivityGroupProps) => {
  const shouldReduceMotion = useReducedMotion();
  const hasPending = isStreaming && items.some((item) => !item.result);
  const [expanded, setExpanded] = useState(hasPending);
  const [previousHasPending, setPreviousHasPending] = useState(hasPending);
  if (previousHasPending !== hasPending) {
    setPreviousHasPending(hasPending);
    if (!hasPending) setExpanded(false);
  }
  const summaryItems = items.map((item) => ({
    call: item.call,
    pending: isStreaming && !item.result,
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
        animateEntrance={animateEntrance}
        assistantMessageId={assistantMessageId}
        call={item.call}
        isStreaming={isStreaming}
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
          <LoadingDots />
        ) : (
          <HugeiconsIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 text-muted-fg/45", {
              "rotate-90": expanded,
              "transition-none": shouldReduceMotion,
              "transition-transform duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out)":
                !shouldReduceMotion,
            })}
            icon={ArrowRight01Icon}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm/relaxed text-muted-fg">
          <span className="capitalize">{summary}</span>
          {activeDetail ? <span className="ml-2 text-muted-fg/70">{activeDetail}</span> : null}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div {...getAppPresenceMotion({ reducedMotion: shouldReduceMotion })}>
            <div className="mt-1.5 space-y-0.5 border-l border-border pl-3">
              {items.map((item) => (
                <ToolPart
                  actionsDisabled={actionsDisabled}
                  animateEntrance={animateEntrance}
                  assistantMessageId={assistantMessageId}
                  call={item.call}
                  isStreaming={isStreaming}
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
