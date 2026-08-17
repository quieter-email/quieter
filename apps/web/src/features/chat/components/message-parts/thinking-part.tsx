"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";

import { getAppPresenceMotion } from "#/features/motion/app-motion";

import { MarkdownContent } from "../markdown-content";
import { LoadingDots } from "../thinking-indicator";
import { reasoningIcon } from "./tools/tool-icons";

type ThinkingPartProps = {
  content: string;
  isActive: boolean;
};

export const ThinkingPart = ({ content, isActive }: ThinkingPartProps) => {
  const shouldReduceMotion = useReducedMotion();
  const [override, setOverride] = useState<boolean | null>(null);
  const hasReasoning = Boolean(content.trim());
  // Follow the reasoning while it is being written, then fold it away once the model
  // moves on. An explicit toggle wins until this part becomes active again.
  const expanded = (override ?? isActive) && hasReasoning;

  if (!(hasReasoning || isActive)) {
    return null;
  }

  return (
    <div className="py-1">
      <button
        aria-expanded={hasReasoning ? expanded : undefined}
        aria-label={hasReasoning ? "Toggle reasoning" : "Thinking"}
        className={cn(
          "group flex w-full max-w-full items-center gap-2.5 text-left",
          { "cursor-default": !hasReasoning }
        )}
        disabled={!hasReasoning}
        onClick={() => {
          setOverride(!expanded);
        }}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-fg/60"
          icon={reasoningIcon}
        />
        <span className="min-w-0 flex-1 truncate text-sm/5 text-muted-fg">
          {isActive ? "Thinking" : "Thought process"}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {isActive ? <LoadingDots /> : null}
          {hasReasoning ? (
            <HugeiconsIcon
              aria-hidden
              className={cn(
                "size-3.5 text-muted-fg/50",
                "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                {
                  "rotate-90 opacity-100": expanded,
                  "transition-[transform,opacity] duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out)":
                    shouldReduceMotion !== true,
                  "transition-none": shouldReduceMotion === true,
                }
              )}
              icon={ArrowRight01Icon}
            />
          ) : null}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <m.div
            {...getAppPresenceMotion({ reducedMotion: shouldReduceMotion })}
          >
            <div className="mt-1.5 ml-6 rounded-md border border-border bg-bg-surface p-2.5 text-xs/relaxed text-muted-fg">
              <MarkdownContent markdown={content} />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
