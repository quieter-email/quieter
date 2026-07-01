"use client";

import type { ReactNode } from "react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m } from "motion/react";

type ToolStepProps = {
  children?: ReactNode;
  detail?: string;
  error?: string | null;
  expanded?: boolean;
  expandable?: boolean;
  label: string;
  meta?: string;
  nested?: boolean;
  onToggle?: () => void;
  pending?: boolean;
};

export const ToolStep = ({
  children,
  detail,
  error,
  expanded = false,
  expandable = false,
  label,
  meta,
  nested = false,
  onToggle,
  pending = false,
}: ToolStepProps) => {
  const hasError = Boolean(error);
  const canExpand = expandable && !pending && !hasError;

  return (
    <div className={cn({ "py-1": nested, "py-0.5": !nested })}>
      <button
        aria-expanded={canExpand ? expanded : undefined}
        className={cn("group flex w-full max-w-full items-center gap-2 text-left", {
          "cursor-default": !canExpand,
          "cursor-pointer": canExpand,
        })}
        disabled={!canExpand}
        onClick={canExpand ? onToggle : undefined}
        type="button"
      >
        {nested ? (
          canExpand ? (
            <HugeiconsIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/45 transition-transform duration-200",
                { "rotate-90": expanded },
              )}
              icon={ArrowRight01Icon}
            />
          ) : (
            <span aria-hidden className="size-3.5 shrink-0" />
          )
        ) : null}
        <span
          className={cn("flex min-w-0 flex-1 items-baseline gap-x-2 truncate", {
            "text-sm/relaxed": nested,
            "text-sm/5": !nested,
          })}
        >
          <span
            className={cn({
              "text-destructive": hasError,
              "text-muted-foreground": !hasError,
            })}
          >
            {label}
          </span>
          {detail ? <span className="text-foreground/75">{detail}</span> : null}
          {meta ? <span className="text-muted-foreground/65">{meta}</span> : null}
          {hasError ? (
            <span className="border-l border-destructive/30 pl-2 text-destructive/90">{error}</span>
          ) : null}
        </span>
        {!nested && canExpand ? (
          <HugeiconsIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              { "rotate-90 opacity-100": expanded },
            )}
            icon={ArrowRight01Icon}
          />
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {expanded && children ? (
          <m.div
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div
              className={cn("mt-1.5 border-l border-border/70", {
                "ml-1.5 pl-3": nested,
                "pl-3": !nested,
              })}
            >
              {children}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
