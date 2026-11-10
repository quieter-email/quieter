"use client";

import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Kbd = ({
  className,
  variant = "keycap",
  ...props
}: ComponentPropsWithoutRef<"kbd"> & { variant?: "keycap" | "hint" }) => (
  <kbd
    data-slot={variant === "hint" ? "shortcut-hint" : "kbd"}
    className={cn(
      "inline-flex shrink-0 items-center justify-center font-mono text-micro",
      {
        "font-normal whitespace-nowrap text-current opacity-60":
          variant === "hint",
        "h-6 min-w-6 rounded-md bg-detail px-1.5 font-medium text-fg":
          variant === "keycap",
      },
      className
    )}
    {...props}
  />
);
