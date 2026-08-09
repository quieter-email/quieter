"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import type { MessagePart } from "@tanstack/ai";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";

import { getAppPresenceMotion } from "#/features/motion/app-motion";

import {
  getActiveToolDetail,
  summarizeToolCalls,
} from "../../../domain/tool-summaries";
import type { ResolveComposeTool } from "../../../types";
import { LoadingDots } from "../../thinking-indicator";
import { ToolPart } from "../tool-part";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

type ToolActivityGroupProps = {
  actionsDisabled?: boolean;
  animateEntrance?: boolean;
  assistantMessageId: string;
  isStreaming?: boolean;
  items: { call: ToolCall; result?: ToolResult }[];
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
    if (!hasPending) {
      setExpanded(false);
    }
  }
  const summaryItems = items.map((item) => ({
    call: item.call,
    pending: isStreaming && !item.result,
    result: item.result,
  }));
  const summary = summarizeToolCalls(summaryItems);
  const activeItem = items.find((item) => !item.result) ?? items.at(-1);
  const activeDetail =
    hasPending && activeItem
      ? getActiveToolDetail(activeItem.call, activeItem.result)
      : undefined;

  if (items.length === 1) {
    const [item] = items;
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
        onClick={() => {
          setExpanded((current) => !current);
        }}
        type="button"
      >
        {hasPending && isStreaming ? (
          <LoadingDots />
        ) : (
          <HugeiconsIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 text-muted-fg/45", {
              "rotate-90": expanded,
              "transition-none": shouldReduceMotion === true,
              "transition-transform duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out)":
                shouldReduceMotion !== true,
            })}
            icon={ArrowRight01Icon}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm/relaxed text-muted-fg">
          <span className="capitalize">{summary}</span>
          {activeDetail !== undefined && activeDetail !== "" ? (
            <span className="ml-2 text-muted-fg/70">{activeDetail}</span>
          ) : null}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div
            {...getAppPresenceMotion({ reducedMotion: shouldReduceMotion })}
          >
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
