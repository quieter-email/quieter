"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { getAppPresenceMotion } from "#/features/motion/app-motion";

import { LoadingDots } from "../../thinking-indicator";
import type { ToolIcon } from "./tool-icons";
import { unknownToolIcon } from "./tool-icons";

type ToolStepProps = {
  /** The step the model is on right now: show its result until the model moves on. */
  active?: boolean;
  children?: ReactNode;
  detail?: string;
  error?: string | null;
  expandable?: boolean;
  icon?: ToolIcon;
  label: string;
  meta?: string;
  nested?: boolean;
  pending?: boolean;
};

const hasRenderableChildren = (children: ReactNode) =>
  children !== null &&
  children !== undefined &&
  children !== false &&
  children !== true &&
  children !== "";

/**
 * One right-hand slot for the row's state, so a step does not reflow as it settles:
 * progress while it runs, then its result count, with disclosure alongside.
 */
const ToolStepTrailing = ({
  canExpand,
  expanded,
  meta,
  pending,
  shouldReduceMotion,
}: {
  canExpand: boolean;
  expanded: boolean;
  meta?: string;
  pending: boolean;
  shouldReduceMotion: boolean | null;
}) => (
  <span className="flex shrink-0 items-center gap-2">
    {pending ? <LoadingDots /> : null}
    {!pending && meta !== undefined && meta !== "" ? (
      <span className="text-caption text-muted-fg/65">{meta}</span>
    ) : null}
    {canExpand ? (
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
);

export const ToolStep = ({
  active = false,
  children,
  detail,
  error,
  expandable = false,
  icon = unknownToolIcon,
  label,
  meta,
  nested = false,
  pending = false,
}: ToolStepProps) => {
  const shouldReduceMotion = useReducedMotion();
  const [override, setOverride] = useState<boolean | null>(null);
  const hasError = Boolean(error);
  const canExpand = expandable && !pending && !hasError;
  // Reveal what the step found while it is the model's current step, then fold it away
  // once the model moves on. An explicit toggle wins from then on.
  const expanded = canExpand && (override ?? active);

  return (
    <div className="py-1">
      <button
        aria-expanded={canExpand ? expanded : undefined}
        className={cn(
          "group flex w-full max-w-full items-center gap-2.5 text-left",
          {
            "cursor-default": !canExpand,
            "cursor-pointer": canExpand,
          }
        )}
        disabled={!canExpand}
        onClick={() => {
          setOverride(!expanded);
        }}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden
          className={cn("size-3.5 shrink-0", {
            "text-destructive/80": hasError,
            "text-muted-fg/60": !hasError && !pending,
            "text-muted-fg/80": pending && !hasError,
          })}
          icon={icon}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-x-2 truncate text-body/5">
          <span
            className={cn("shrink-0", {
              "text-destructive": hasError,
              "text-muted-fg": !hasError,
            })}
          >
            {label}
          </span>
          {detail !== undefined && detail !== "" ? (
            <span className="truncate text-fg/75">{detail}</span>
          ) : null}
          {hasError ? (
            <span className="truncate text-destructive/90">{error}</span>
          ) : null}
        </span>
        <ToolStepTrailing
          canExpand={canExpand}
          expanded={expanded}
          meta={meta}
          pending={pending}
          shouldReduceMotion={shouldReduceMotion}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && hasRenderableChildren(children) ? (
          <m.div
            {...getAppPresenceMotion({ reducedMotion: shouldReduceMotion })}
          >
            <div
              className={cn(
                "mt-1.5 rounded-md border border-border bg-bg-surface p-2.5",
                { "ml-6": !nested }
              )}
            >
              {children}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
