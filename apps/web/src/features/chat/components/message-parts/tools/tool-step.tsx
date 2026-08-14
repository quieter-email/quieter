"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { getAppPresenceMotion } from "#/features/motion/app-motion";

import { LoadingDots } from "../../thinking-indicator";

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

const getLeadingIndicator = ({
  canExpand,
  expanded,
  nested,
  pending,
  shouldReduceMotion,
}: {
  canExpand: boolean;
  expanded: boolean;
  nested: boolean;
  pending: boolean;
  shouldReduceMotion: boolean | null;
}): ReactNode => {
  if (pending) {
    return <LoadingDots />;
  }
  if (nested && canExpand) {
    return (
      <HugeiconsIcon
        aria-hidden
        className={cn("size-3.5 shrink-0 text-muted-fg/45", {
          "rotate-90": expanded,
          "transition-none": shouldReduceMotion,
          "transition-transform duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out)":
            shouldReduceMotion !== true,
        })}
        icon={ArrowRight01Icon}
      />
    );
  }
  return nested ? <span aria-hidden className="size-3.5 shrink-0" /> : null;
};

const hasRenderableChildren = (children: ReactNode) =>
  children !== null &&
  children !== undefined &&
  children !== false &&
  children !== true &&
  children !== "";

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
  const shouldReduceMotion = useReducedMotion();
  const hasError = Boolean(error);
  const canExpand = expandable && !pending && !hasError;
  const leadingIndicator = getLeadingIndicator({
    canExpand,
    expanded,
    nested,
    pending,
    shouldReduceMotion,
  });

  return (
    <div className={cn({ "py-0.5": !nested, "py-1": nested })}>
      <button
        aria-expanded={canExpand ? expanded : undefined}
        className={cn(
          "group flex w-full max-w-full items-center gap-2 text-left",
          {
            "cursor-default": !canExpand,
            "cursor-pointer": canExpand,
          }
        )}
        disabled={!canExpand}
        onClick={canExpand ? onToggle : undefined}
        type="button"
      >
        {leadingIndicator}
        <span
          className={cn("flex min-w-0 flex-1 items-baseline gap-x-2 truncate", {
            "text-sm/5": !nested,
            "text-sm/relaxed": nested,
          })}
        >
          <span
            className={cn({
              "text-destructive": hasError,
              "text-muted-fg": !hasError,
            })}
          >
            {label}
          </span>
          {detail !== undefined && detail !== "" ? (
            <span className="text-fg/75">{detail}</span>
          ) : null}
          {meta !== undefined && meta !== "" ? (
            <span className="text-muted-fg/65">{meta}</span>
          ) : null}
          {hasError ? (
            <span className="border-l border-destructive/30 pl-2 text-destructive/90">
              {error}
            </span>
          ) : null}
        </span>
        {!nested && canExpand ? (
          <HugeiconsIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-fg/50",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              {
                "rotate-90 opacity-100": expanded,
                "transition-none": shouldReduceMotion,
                "transition-transform duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out)":
                  shouldReduceMotion !== true,
              }
            )}
            icon={ArrowRight01Icon}
          />
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {expanded && hasRenderableChildren(children) ? (
          <m.div
            {...getAppPresenceMotion({ reducedMotion: shouldReduceMotion })}
          >
            <div
              className={cn("mt-1.5 border-l border-border", {
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
