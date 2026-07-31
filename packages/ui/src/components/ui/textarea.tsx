"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

export const Textarea = ({ className, ...props }: ComponentPropsWithoutRef<"textarea">) => (
  <textarea
    className={cn(
      "squircle min-h-20 w-full resize-y rounded-md border border-border bg-bg-elevated/60 px-3 py-2 text-sm text-fg shadow-sm transition-colors duration-150 ease-out placeholder:text-muted-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/45",
      className,
    )}
    {...props}
  />
);
