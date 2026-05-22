"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { m } from "motion/react";
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
    <div className="flex flex-col gap-1">
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
            className="bg-gradient-to-r from-muted-foreground/35 via-muted-foreground/85 to-muted-foreground/35 bg-[length:200%_auto] bg-clip-text text-xs text-transparent"
            transition={{ duration: 2.4, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
          >
            Thinking
          </m.span>
        ) : (
          <span className="text-xs text-muted-foreground/60">Thinking</span>
        )}
        {hasReasoning ? (
          <HugeiconsIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-[opacity,transform] duration-150",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              { "rotate-90 opacity-100": expanded },
            )}
            icon={ArrowRight01Icon}
          />
        ) : null}
      </button>
      {expanded && hasReasoning ? (
        <MarkdownContent
          className="prose-sm prose-headings:text-muted-foreground/70 prose-p:text-xs prose-p:leading-5 prose-p:text-muted-foreground/60 prose-p:italic prose-code:text-muted-foreground/70"
          markdown={content}
        />
      ) : null}
    </div>
  );
};
