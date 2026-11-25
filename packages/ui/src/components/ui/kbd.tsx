"use client";

import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Kbd = ({
  className,
  size = "default",
  variant = "keycap",
  ...props
}: ComponentPropsWithoutRef<"kbd"> & {
  size?: "default" | "sm";
  variant?: "keycap" | "hint";
}) => (
  <kbd
    data-slot={variant === "hint" ? "shortcut-hint" : "kbd"}
    className={cn(
      "inline-flex shrink-0 items-center justify-center font-mono text-micro",
      {
        "font-normal whitespace-nowrap text-current opacity-60":
          variant === "hint",
        "h-5 min-w-5 rounded-xs bg-fg/8 px-1.5 font-medium text-muted-fg":
          variant === "keycap" && size === "sm",
        "h-6 min-w-6 rounded-md bg-detail px-1.5 font-medium text-fg":
          variant === "keycap" && size === "default",
      },
      className
    )}
    {...props}
  />
);
