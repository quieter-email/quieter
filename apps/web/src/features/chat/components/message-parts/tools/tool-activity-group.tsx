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
import { toolGroupIcon } from "./tool-icons";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

type ToolActivityGroupProps = {
  actionsDisabled?: boolean;
  /** The tool call the model is on right now, if it is one of these. */
  activeToolCallId?: string | null;
  animateEntrance?: boolean;
  assistantMessageId: string;
  isStreaming?: boolean;
  items: { call: ToolCall; result?: ToolResult }[];
  onResolveCompose: ResolveComposeTool;
};

export const ToolActivityGroup = ({
  actionsDisabled,
  activeToolCallId = null,
  animateEntrance = false,
  assistantMessageId,
  isStreaming = false,
  items,
  onResolveCompose,
}: ToolActivityGroupProps) => {
  const shouldReduceMotion = useReducedMotion();
  const hasPending = isStreaming && items.some((item) => !item.result);
  const isActiveGroup =
    hasPending ||
    (activeToolCallId !== null &&
      items.some((item) => item.call.id === activeToolCallId));
  const [override, setOverride] = useState<boolean | null>(null);
  // Follow the group while the model works through it, then fold it away. An explicit
  // toggle wins until the model comes back to this group.
  const expanded = override ?? isActiveGroup;
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
        active={item.call.id === activeToolCallId}
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
        className="group flex w-full items-center gap-2.5 text-left"
        onClick={() => {
          setOverride(!expanded);
        }}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-fg/60"
          icon={toolGroupIcon}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-x-2 truncate text-sm/5">
          <span className="shrink-0 text-muted-fg capitalize">{summary}</span>
          {activeDetail !== undefined && activeDetail !== "" ? (
            <span className="truncate text-fg/75">{activeDetail}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {hasPending ? <LoadingDots /> : null}
          <HugeiconsIcon
            aria-hidden
            className={cn("size-3.5 text-muted-fg/50", {
              "rotate-90": expanded,
              "transition-none": shouldReduceMotion === true,
              "transition-transform duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out)":
                shouldReduceMotion !== true,
            })}
            icon={ArrowRight01Icon}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div
            {...getAppPresenceMotion({ reducedMotion: shouldReduceMotion })}
          >
            <div className="mt-0.5 ml-6">
              {items.map((item) => (
                <ToolPart
                  actionsDisabled={actionsDisabled}
                  active={item.call.id === activeToolCallId}
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
