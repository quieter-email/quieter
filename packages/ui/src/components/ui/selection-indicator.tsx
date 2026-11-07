"use client";

import { m, useReducedMotion } from "motion/react";

import { cn } from "../../lib/cn";

export const SelectionIndicator = ({
  layoutId = "selection",
  variant = "default",
}: {
  layoutId?: string;
  variant?: "default" | "primary" | "secondary";
}) => {
  const reducedMotion = useReducedMotion() === true;
  return (
    <m.span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 rounded-[inherit] [corner-shape:inherit]",
        {
          "bg-primary": variant === "primary",
          "bg-selection shadow-sm": variant !== "primary",
        }
      )}
      initial={false}
      layoutId={reducedMotion ? undefined : layoutId}
      transition={{ layout: { bounce: 0, duration: 0.24, type: "spring" } }}
    />
  );
};
