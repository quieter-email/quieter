"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";
import { getAppPresenceMotion } from "~/features/motion/app-motion";
import { MarkdownContent } from "../markdown-content";
import { LoadingDots } from "../thinking-indicator";

type ThinkingPartProps = {
  content: string;
  isActive: boolean;
};

export const ThinkingPart = ({ content, isActive }: ThinkingPartProps) => {
  const shouldReduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const hasReasoning = Boolean(content.trim());

  if (!isActive) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <button
        aria-expanded={expanded}
        aria-label={hasReasoning ? "Toggle reasoning" : "Thinking"}
        className="group flex w-fit items-center gap-1 py-0.5 text-left"
        disabled={!hasReasoning}
        onClick={() => setExpanded((prev) => !prev)}
        type="button"
      >
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-fg">
          <LoadingDots />
          Thinking
        </span>
        {hasReasoning ? (
          <HugeiconsIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-muted-fg",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              {
                "rotate-90 opacity-100": expanded,
                "transition-none": shouldReduceMotion,
                "transition-transform duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out)":
                  !shouldReduceMotion,
              },
            )}
            icon={ArrowRight01Icon}
          />
        ) : null}
      </button>
      <AnimatePresence initial={false}>
        {expanded && hasReasoning ? (
          <m.div {...getAppPresenceMotion({ reducedMotion: shouldReduceMotion })}>
            <div className="py-1">
              <MarkdownContent markdown={content} />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
