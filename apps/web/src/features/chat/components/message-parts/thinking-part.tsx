"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import { MarkdownContent } from "../markdown-content";

type ThinkingPartProps = {
  content: string;
  isActive: boolean;
};

export const ThinkingPart = ({ content, isActive }: ThinkingPartProps) => {
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
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span className="inline-flex gap-0.5">
            <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
            <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
            <span className="size-1 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
          </span>
          Thinking
        </span>
        {hasReasoning ? (
          <HugeiconsIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              { "rotate-90 opacity-100": expanded },
            )}
            icon={ArrowRight01Icon}
          />
        ) : null}
      </button>
      <AnimatePresence initial={false}>
        {expanded && hasReasoning ? (
          <m.div
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="py-1">
              <MarkdownContent
                className="prose-headings:text-muted-foreground prose-p:text-xs/5 prose-p:text-muted-foreground prose-p:italic prose-code:text-muted-foreground"
                markdown={content}
              />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
