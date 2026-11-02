"use client";

import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Kbd = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"kbd">) => (
  <kbd
    className={cn(
      "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-detail px-1.5 font-mono text-micro font-medium text-fg",
      className
    )}
    {...props}
  />
);
