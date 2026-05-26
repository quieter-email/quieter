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
        {isActive ? (
          <m.span
            animate={{ backgroundPosition: ["200% center", "-200% center"] }}
            className="bg-gradient-to-r from-muted-foreground/30 via-muted-foreground/70 to-muted-foreground/30 bg-[length:200%_auto] bg-clip-text text-xs text-transparent"
            transition={{ duration: 2.8, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
          >
            Thinking
          </m.span>
        ) : (
          <span className="text-xs text-muted-foreground/50">Thought</span>
        )}
        {hasReasoning ? (
          <HugeiconsIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200 ease-out",
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
            <div className="pt-1 pb-1">
              <MarkdownContent
                className="prose-sm prose-headings:text-muted-foreground/60 prose-p:text-xs prose-p:leading-5 prose-p:text-muted-foreground/50 prose-p:italic prose-code:text-muted-foreground/60"
                markdown={content}
              />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
